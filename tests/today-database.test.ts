import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { TodayResult } from "../lib/today/schema";
import type { NotificationPage } from "../lib/notifications/schema";
test("Pawport Today and unified notifications: actual PostgreSQL permissions and current state", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    a = randomUUID(),
    b = randomUUID(),
    provider = randomUUID();
  async function role(id?: string, worker = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (worker) await pg.exec("set role pawport_appointment_worker");
    else if (id) await pg.exec("set role authenticated");
  }
  async function val<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const today = (zone = "UTC") =>
    val<TodayResult>("select my_pawport_today($1) as result", [zone]);
  const notices = (
    limit = 25,
    cursor: NotificationPage["nextCursor"] = null,
    unread = false,
  ) =>
    val<NotificationPage>("select my_notifications($1,$2,$3,$4) as result", [
      unread,
      cursor?.at || null,
      cursor?.id || null,
      limit,
    ]);
  const process = () =>
    val<number>("select process_appointment_reminders() as result");
  let ha: string, pet: string, pet2: string, foreign: string, hb: string;
  const date = async (days = 0) =>
    val(
      "select ((now() at time zone 'UTC')::date+$1::integer)::text as result",
      [days],
    );
  const plan = async (title: string, days = 0, time = "") =>
    val("select save_care_plan(null,$1,$2) as result", [
      pet,
      {
        title,
        category: "custom",
        instructions: "",
        recurrence_type: "one_time",
        interval_value: null,
        interval_unit: null,
        time_zone: "UTC",
        anchor_local_date: await date(days),
        anchor_local_time: time,
        ends_on: "",
        reminders: [0],
      },
    ]);
  const appointment = async (
    title: string,
    hours = 1,
    status = "scheduled",
    p = pet,
    h = ha,
    user = a,
  ) =>
    val(
      "insert into appointments(household_id,pet_id,created_by,source,title,appointment_type,starts_at,status,time_zone) values($1,$2,$3,'manual',$4,'veterinary',now()+make_interval(hours=>$5),$6,'UTC') returning id as result",
      [h, p, user, title, hours, status],
    );
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );
    for (const f of [
      "001_passport",
      "002_verified_records",
      "003_multi_pet_profiles",
      "004_local_services_reviews",
      "005_care_calendar",
      "006_scheduling_connections",
      "007_smart_openings",
      "008_care_plans",
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    const before = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110009_pet_timeline.sql",
        "utf8",
      ),
    );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110010_pawport_today.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await pg.query(
          "select * from pg_policies order by schemaname,tablename,policyname",
        )
      ).rows,
      before,
    );
    await pg.query("insert into auth.users(id) values($1),($2),($3)", [
      a,
      b,
      provider,
    ]);
    await role(a);
    ha = await val(
      "insert into households(name) values('A') returning id as result",
    );
    pet = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    pet2 = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jasper','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    await role(b);
    hb = await val(
      "insert into households(name) values('B') returning id as result",
    );
    foreign = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Ellie','Dog','Mixed','Female') returning id as result",
      [hb],
    );
    await role(a);
    await t.test(
      "new household, owner-only access and bounded input",
      async () => {
        const empty = await today();
        assert.deepEqual(empty.attention, []);
        assert.deepEqual(empty.comingUp, []);
        assert.equal(empty.hasTrackedData, false);
        await assert.rejects(today("Invalid/Zone"));
        await assert.rejects(notices(51));
        await assert.rejects(notices(0));
        await assert.rejects(
          pg.exec("select my_notifications(false,now(),null)"),
        );
        for (const id of [a, b, provider]) {
          await role(id);
          await assert.rejects(
            pg.exec("insert into notifications default values"),
          );
          await assert.rejects(
            pg.exec("update notifications set user_id=gen_random_uuid()"),
          );
          await assert.rejects(process());
          await assert.rejects(pg.exec("select * from notifications"));
        }
        await role(provider);
        await assert.rejects(today());
        await role();
        await pg.exec("set role anon");
        await assert.rejects(today());
        await assert.rejects(notices());
        await assert.rejects(pg.exec("select my_notification_count()"));
        await role(a);
      },
    );
    await t.test(
      "care overdue/today/snooze, paused/archived/resolved exclusions and separate upcoming",
      async () => {
        const overdue = await plan("Overdue routine", -2),
          due = await plan("Today routine"),
          soon = await plan("Tomorrow routine", 1);
        const paused = await plan("Paused routine"),
          archived = await plan("Archived routine"),
          complete = await plan("Completed routine"),
          skipped = await plan("Skipped routine");
        await pg.query("select set_care_plan_status($1,'paused')", [paused]);
        await pg.query("select set_care_plan_status($1,'archived')", [
          archived,
        ]);
        const occ = async (id: string) => {
          const p = await val<{ occurrence: { id: string } }[]>(
            "select my_care_plans(null,$1) as result",
            [id],
          );
          return p[0].occurrence.id;
        };
        await pg.query("select complete_care_occurrence($1)", [
          await occ(complete),
        ]);
        await pg.query("select skip_care_occurrence($1)", [await occ(skipped)]);
        let result = await today();
        assert.equal(result.attention[0].title, "Overdue routine");
        assert.equal(result.attention[0].urgency, "overdue");
        assert.equal(
          result.attention.find((i) => i.title === "Today routine")?.urgency,
          "today",
        );
        assert.ok(result.comingUp.some((i) => i.title === "Tomorrow routine"));
        for (const title of [
          "Paused routine",
          "Archived routine",
          "Completed routine",
          "Skipped routine",
        ])
          assert.ok(
            ![...result.attention, ...result.comingUp].some(
              (i) => i.title === title,
            ),
          );
        const oid = await occ(overdue);
        await pg.query(
          "select snooze_care_occurrence($1,now()+interval '3 days')",
          [oid],
        );
        result = await today();
        assert.ok(!result.attention.some((i) => i.id === `care:${oid}`));
        assert.equal(
          result.comingUp.find((i) => i.id === `care:${oid}`)?.metadata.snoozed,
          true,
        );
        assert.ok(
          result.recentActivity.some(
            (e) => e.title === "Completed routine completed",
          ),
        );
        assert.ok(
          result.recentActivity.every((e) => !JSON.stringify(e).includes(ha)),
        );
        assert.ok(result.recentActivity.length <= 5);
        await role(b);
        assert.deepEqual((await today()).attention, []);
        await role(a);
        assert.ok(due && soon);
      },
    );
    await t.test(
      "appointments across pets, tomorrow, cancelled/completed excluded and no inferred vaccine schedule",
      async () => {
        await role();
        const now = await val("select now()::text as result");
        const next = new Date(now);
        const hours = next.getUTCHours();
        const first = await appointment("Visit today", 0),
          second = await appointment("Visit tomorrow", 24, "confirmed", pet2);
        await appointment("Cancelled visit", 1, "cancelled");
        await appointment("Completed visit", 1, "completed");
        const nullV = await val(
          "insert into vaccinations(clinic,pet_id,name,administered_on) values('Clinic',$1,'No explicit expiry',current_date) returning id as result",
          [pet],
        );
        const v = await val(
          "insert into vaccinations(clinic,pet_id,name,administered_on,due_on) values('Clinic',$1,'Rabies',current_date,current_date+12) returning id as result",
          [pet],
        );
        const expired = await val(
          "insert into vaccinations(clinic,pet_id,name,administered_on,due_on) values('Clinic',$1,'Old record',current_date-20,current_date-2) returning id as result",
          [pet],
        );
        await role(a);
        const result = await today();
        assert.ok(
          result.attention.some((i) => i.id === `appointment:${first}`),
        );
        assert.ok(
          result.comingUp.some(
            (i) => i.id === `appointment:${second}` && i.petId === pet2,
          ),
        );
        assert.ok(
          !result.attention.some(
            (i) =>
              i.title === "Cancelled visit" || i.title === "Completed visit",
          ),
        );
        assert.equal(
          result.attention.find((i) => i.id === `vaccination-expiration:${v}`)
            ?.trustState,
          "owner_entered",
        );
        assert.equal(
          result.attention.find(
            (i) => i.id === `vaccination-expiration:${expired}`,
          )?.urgency,
          "overdue",
        );
        assert.ok(
          !JSON.stringify(result).includes(`vaccination-expiration:${nullV}`),
        );
        assert.doesNotMatch(
          JSON.stringify(result.attention),
          /needs a vaccine|booster recommended/i,
        );
        const ids = [...result.attention, ...result.comingUp].map((i) => i.id);
        assert.equal(new Set(ids).size, ids.length);
        // Same absolute instant can belong to different local days; neither query groups by UTC implicitly.
        const east = await today("Pacific/Kiritimati"),
          west = await today("Pacific/Honolulu");
        const e = [...east.attention, ...east.comingUp].find(
            (i) => i.id === `appointment:${second}`,
          ),
          w = [...west.attention, ...west.comingUp].find(
            (i) => i.id === `appointment:${second}`,
          );
        assert.ok(e && w);
        assert.equal(e.dueAt, w.dueAt);
        assert.ok(hours >= 0);
      },
    );
    await t.test(
      "appointment worker, duplicate calls, sent_at, cancellation, safe recipients and reminder removal compatibility",
      async () => {
        await role();
        const ap = await appointment("Reminder visit"),
          cancelled = await appointment("Cancelled reminder", 1, "cancelled");
        const r = await val(
          "insert into appointment_reminders(appointment_id,user_id,reminder_minutes) values($1,$2,120) returning id as result",
          [ap, a],
        );
        await pg.query(
          "insert into appointment_reminders(appointment_id,user_id,reminder_minutes) values($1,$2,120)",
          [cancelled, a],
        );
        await role(undefined, true);
        assert.equal(await process(), 1);
        assert.equal(await process(), 0);
        await assert.rejects(pg.exec("select process_care_reminders()"));
        await assert.rejects(pg.exec("select * from appointments"));
        await role(a);
        const n = (await notices()).notifications.find(
          (n) => n.type === "appointment_reminder",
        )!;
        assert.ok(n);
        assert.equal(n.petName, "Jaxson");
        assert.equal(n.actionUrl, `/appointments/${ap}`);
        assert.ok(
          await val(
            "select sent_at as result from appointment_reminders where id=$1",
            [r],
          ),
        );
        await role(b);
        assert.equal((await notices()).notifications.length, 0);
        await assert.rejects(
          pg.query("select mark_notification_read($1)", [n.id]),
        );
        await role();
        await assert.rejects(
          pg.query(
            "insert into notifications(user_id,type,title,body,action_url,dedupe_key,appointment_reminder_id,subject_pet_id) values($1,'appointment_reminder','Fake','Fake',$2,$3,$4,$5)",
            [b, `/appointments/${ap}`, `appointment-reminder:${r}`, r, foreign],
          ),
        );
        await assert.rejects(
          pg.query("update notifications set subject_pet_id=$1 where id=$2", [
            foreign,
            n.id,
          ]),
        );
        await pg.query("delete from appointment_reminders where id=$1", [r]);
        assert.ok(
          await val(
            "select dismissed_at as result from notifications where id=$1",
            [n.id],
          ),
        );
        await role(a);
        assert.ok(!(await notices()).notifications.some((x) => x.id === n.id));
      },
    );
    let req: string, vaccine: string, clinic: string;
    await t.test(
      "real provider verified transition, provenance, no duplicate or private fields",
      async () => {
        await role();
        clinic = await val(
          "insert into veterinary_providers(name) values('Clinic') returning id as result",
        );
        await pg.query(
          "insert into provider_memberships(provider_id,user_id) values($1,$2)",
          [clinic, provider],
        );
        vaccine = await val(
          "insert into vaccinations(clinic,pet_id,name,administered_on,due_on) values('Clinic',$1,'Verified rabies',current_date,current_date+20) returning id as result",
          [pet],
        );
        req = await val(
          "insert into verification_requests(vaccination_id,provider_id,requested_by,status) values($1,$2,$3,'pending') returning id as result",
          [vaccine, clinic, a],
        );
        await role(provider);
        await pg.query(
          "select complete_vaccination_verification($1,'PRIVATE INTERNAL NOTES')",
          [req],
        );
        assert.equal((await notices()).notifications.length, 0);
        await assert.rejects(today());
        await role(a);
        const n = (await notices()).notifications.find(
          (n) => n.type === "verification_update",
        )!;
        assert.ok(n);
        assert.equal(n.petId, pet);
        const data = await today();
        assert.ok(data.attention.some((i) => i.id === `verification:${req}`));
        assert.equal(
          data.attention.find(
            (i) => i.id === `vaccination-expiration:${vaccine}`,
          )?.trustState,
          "vet_verified",
        );
        for (const forbidden of [
          a,
          ha,
          provider,
          clinic,
          "PRIVATE INTERNAL NOTES",
          "dedupe_key",
          "external_slot_id",
          "object_path",
          "connection_id",
          "household_id",
        ]) {
          assert.ok(!JSON.stringify(data).includes(forbidden), forbidden);
          assert.ok(
            !JSON.stringify(await notices()).includes(forbidden),
            forbidden,
          );
        }
        await role();
        await pg.query(
          "update verification_requests set status='verified' where id=$1",
          [req],
        );
        assert.equal(
          await val<number>(
            "select count(*)::integer as result from notifications where verification_request_id=$1",
            [req],
          ),
          1,
        );
        await assert.rejects(
          pg.query(
            "insert into notifications(user_id,type,title,body,action_url,dedupe_key,verification_request_id,subject_pet_id) values($1,'verification_update','Fake','Fake',$2,$3,$4,$5)",
            [
              b,
              `/pets/${foreign}/records`,
              `verification:${req}:verified`,
              req,
              foreign,
            ],
          ),
        );
        await role(a);
      },
    );
    await t.test(
      "notification total order pagination, unread count, mark read/dismiss/all and revocation retirement",
      async () => {
        // Same timestamp ties use UUID ordering; normal provider transitions emit each row.
        await role();
        await pg.exec("begin");
        for (let i = 0; i < 6; i++) {
          const v = await val(
            "insert into vaccinations(clinic,pet_id,name,administered_on) values('Clinic',$1,$2,current_date) returning id as result",
            [pet, `Vaccine ${i}`],
          );
          await pg.query(
            "insert into verification_requests(vaccination_id,provider_id,requested_by,status,verified_at,verified_by,provider_name) values($1,$2,$3,'verified',now(),$4,'Clinic')",
            [v, clinic, a, provider],
          );
        }
        await role(a);
        await pg.exec("commit");
        const all = await notices(50);
        let cursor: NotificationPage["nextCursor"] = null;
        const ids: string[] = [];
        do {
          const p = await notices(2, cursor);
          ids.push(...p.notifications.map((n) => n.id));
          cursor = p.nextCursor;
        } while (cursor);
        assert.deepEqual(
          ids,
          all.notifications.map((n) => n.id),
        );
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(
          await val<number>("select my_notification_count() as result"),
          ids.length,
        );
        await pg.query("select mark_notification_read($1)", [ids[0]]);
        assert.equal(
          (await notices(50, null, true)).notifications.length,
          ids.length - 1,
        );
        await pg.query("select mark_notification_read($1,true)", [ids[1]]);
        assert.ok(
          !(await notices(50)).notifications.some((n) => n.id === ids[1]),
        );
        await role(b);
        await pg.exec("select mark_all_notifications_read()");
        await role(a);
        assert.equal(
          await val<number>("select my_notification_count() as result"),
          ids.length - 2,
        );
        await pg.exec("select mark_all_notifications_read()");
        assert.equal(
          await val<number>("select my_notification_count() as result"),
          0,
        );
        assert.ok(
          !(await today()).attention.some(
            (i) => i.kind === "verification_result",
          ),
        );
        await role();
        await pg.query(
          "update verification_requests set status='revoked',revoked_at=now() where id=$1",
          [req],
        );
        assert.ok(
          await val(
            "select dismissed_at as result from notifications where verification_request_id=$1",
            [req],
          ),
        );
        await role(a);
        const result = await today();
        assert.ok(
          result.attention.length <= 10 &&
            result.comingUp.length <= 10 &&
            result.recentActivity.length <= 5,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
