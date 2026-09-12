import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { CarePlan, CareHistory } from "../lib/care-plans/schema";
test("Care plans PostgreSQL recurrence, privacy, lifecycle and reminders", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID();
  async function role(id?: string, worker = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (worker) await pg.exec("set role pawport_care_worker");
    else if (id) await pg.exec("set role authenticated");
  }
  async function val<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const input = {
    title: "Owner routine",
    category: "custom",
    instructions: "My reminder",
    recurrence_type: "interval",
    interval_value: 1,
    interval_unit: "month",
    time_zone: "America/New_York",
    anchor_local_date: "2026-01-31",
    anchor_local_time: "20:00",
    ends_on: "",
    reminders: [0, 120],
  };
  let pet: string, otherPet: string, hh: string;
  const data = (extra: Record<string, unknown> = {}) => ({
    ...input,
    ...extra,
  });
  async function save(
    extra: Record<string, unknown> = {},
    id: string | null = null,
    petId = pet,
  ) {
    return val("select save_care_plan($1,$2,$3) as result", [
      id,
      petId,
      data(extra),
    ]);
  }
  async function plans() {
    return val<CarePlan[]>("select my_care_plans() as result");
  }
  async function plan(id: string) {
    return (await plans()).find((p) => p.id === id)!;
  }
  async function history(id: string) {
    return val<{ history: CareHistory[] }>(
      "select care_plan_detail($1) as result",
      [id],
    );
  }
  async function resolved(id: string, action = "complete") {
    const o = (await plan(id)).occurrence!;
    await pg.query(`select ${action}_care_occurrence($1)`, [o.id]);
    return o;
  }
  try {
    await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    for (const f of [
      "001_passport",
      "002_verified_records",
      "003_multi_pet_profiles",
      "004_local_services_reviews",
      "005_care_calendar",
      "006_scheduling_connections",
      "007_smart_openings",
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    const policies = await pg.query(
      "select * from pg_policies order by schemaname,tablename,policyname",
    );
    await pg.query("insert into auth.users(id) values($1),($2)", [a, b]);
    await role(a);
    hh = await val(
      "insert into households(name) values('A') returning id as result",
    );
    pet = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id as result",
      [hh],
    );
    await role(b);
    const hb = await val(
      "insert into households(name) values('B') returning id as result",
    );
    otherPet = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Ellie','Dog','Mixed','Female') returning id as result",
      [hb],
    );
    await role();
    await pg.exec(
      await readFile("supabase/migrations/202609110008_care_plans.sql", "utf8"),
    );
    assert.deepEqual(
      (
        await pg.query(
          "select * from pg_policies order by schemaname,tablename,policyname",
        )
      ).rows,
      policies.rows,
    );
    await role(a);
    await t.test(
      "owner creates own plan; cross-household, spoofed fields, anonymous and direct writes rejected",
      async () => {
        const id = await save();
        assert.equal((await plan(id)).source, "owner_entered");
        assert.equal((await plan(id)).pet_id, pet);
        await assert.rejects(save({}, null, otherPet));
        await assert.rejects(save({ created_by: b }));
        await assert.rejects(save({ household_id: hb }));
        await assert.rejects(save({ time_zone: "Not/AZone" }));
        await assert.rejects(save({ interval_value: null }));
        await assert.rejects(save({ title: "x".repeat(121) }));
        await assert.rejects(save({ instructions: "x".repeat(1001) }));
        await assert.rejects(save({ reminders: Array(6).fill(0) }));
        for (const table of [
          "care_plans",
          "care_plan_occurrences",
          "care_plan_reminders",
          "notifications",
        ]) {
          await assert.rejects(pg.exec(`select * from ${table}`));
          await assert.rejects(pg.exec(`insert into ${table} default values`));
          await assert.rejects(pg.exec(`delete from ${table}`));
        }
        await assert.rejects(
          pg.query("select process_care_reminders(now(),200)"),
        );
        await assert.rejects(
          pg.query("select generate_care_occurrence($1,1)", [id]),
        );
        await role(b);
        assert.equal((await plans()).length, 0);
        assert.equal(
          await val("select care_plan_detail($1) as result", [id]),
          null,
        );
        await assert.rejects(save({}, id, otherPet));
        await assert.rejects(
          pg.query("select set_care_plan_status($1,'archived')", [id]),
        );
        await role(a);
        const ownedOccurrence = (await plan(id)).occurrence!.id;
        await role(b);
        await assert.rejects(
          pg.query("select complete_care_occurrence($1)", [ownedOccurrence]),
        );
        await role();
        await pg.exec("set role anon");
        await assert.rejects(pg.exec("select my_care_plans()"));
        await assert.rejects(pg.exec("select * from care_plan_occurrences"));
        await role(a);
      },
    );
    await t.test(
      "identity and completed history cannot move, even through privileged updates",
      async () => {
        const id = await save(),
          o = await resolved(id);
        await role();
        await assert.rejects(
          pg.query("update care_plans set pet_id=$1 where id=$2", [
            otherPet,
            id,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update care_plans set household_id=$1,created_by=$2,pet_id=$3 where id=$4",
            [hb, b, otherPet, id],
          ),
        );
        await assert.rejects(
          pg.query("update care_plan_occurrences set plan_id=$1 where id=$2", [
            randomUUID(),
            o.id,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update care_plan_occurrences set completion_note='rewrite' where id=$1",
            [o.id],
          ),
        );
        await role(a);
      },
    );
    await t.test(
      "monthly anchor January 31 -> February 28 -> March 31; completion safe twice",
      async () => {
        const id = await save();
        assert.match(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          /2026-02-01T01:00/,
        );
        const o = await resolved(id);
        await pg.query("select complete_care_occurrence($1)", [o.id]);
        assert.match(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          /2026-03-01T01:00/,
        );
        assert.equal((await history(id)).history.length, 1);
        await resolved(id);
        assert.match(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          /2026-04-01T00:00/,
        );
      },
    );
    await t.test(
      "one time, daily, N days, weekly, N weeks, N months, leap year and end dates",
      async () => {
        for (const [unit, n, anchor, next] of [
          ["day", 1, "2026-09-01", "2026-09-03T00:00"],
          ["day", 3, "2026-09-01", "2026-09-05T00:00"],
          ["week", 1, "2026-09-01", "2026-09-09T00:00"],
          ["week", 2, "2026-09-01", "2026-09-16T00:00"],
          ["month", 6, "2026-01-31", "2026-08-01T00:00"],
          ["month", 1, "2028-01-31", "2028-03-01T01:00"],
        ] as const) {
          const id = await save({
            interval_unit: unit,
            interval_value: n,
            anchor_local_date: anchor,
          });
          await resolved(id);
          assert.ok(
            new Date((await plan(id)).occurrence!.scheduled_for)
              .toISOString()
              .startsWith(next),
          );
        }
        const once = await save({
          recurrence_type: "one_time",
          interval_unit: null,
          interval_value: null,
        });
        await resolved(once);
        assert.equal((await plan(once)).occurrence, null);
        const end = await save({ ends_on: "2026-02-28" });
        await resolved(end);
        await resolved(end);
        assert.equal((await plan(end)).occurrence, null);
      },
    );
    await t.test(
      "DST preserves local 8 PM; spring gap shifts forward and fall fold uses standard time",
      async () => {
        for (const [anchor, time, first, next] of [
          ["2026-03-07", "20:00", "2026-03-08T01:00", "2026-03-09T00:00"],
          ["2026-10-31", "20:00", "2026-11-01T00:00", "2026-11-02T01:00"],
          ["2026-03-07", "02:30", "2026-03-07T07:30", "2026-03-08T07:30"],
          ["2026-10-31", "01:30", "2026-10-31T05:30", "2026-11-01T06:30"],
        ] as const) {
          const id = await save({
            interval_unit: "day",
            anchor_local_date: anchor,
            anchor_local_time: time,
          });
          assert.ok(
            new Date((await plan(id)).occurrence!.scheduled_for)
              .toISOString()
              .startsWith(first),
          );
          await resolved(id);
          assert.ok(
            new Date((await plan(id)).occurrence!.scheduled_for)
              .toISOString()
              .startsWith(next),
          );
        }
      },
    );
    await t.test(
      "concurrent queued completion requests preserve one next occurrence, late completion does not drift",
      async () => {
        const id = await save({ anchor_local_date: "2026-09-01" }),
          o = (await plan(id)).occurrence!;
        await Promise.all([
          pg.query("select complete_care_occurrence($1)", [o.id]),
          pg.query("select complete_care_occurrence($1)", [o.id]),
        ]);
        assert.equal((await history(id)).history.length, 1);
        assert.match(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          /2026-10-02T00:00/,
        );
        await role();
        await assert.rejects(
          pg.query(
            "insert into care_plan_occurrences(plan_id,revision,sequence,scheduled_for,title_snapshot,category_snapshot,time_zone_snapshot) values($1,1,9,now(),'x','custom','UTC')",
            [id],
          ),
        );
        await role(a);
      },
    );
    await t.test(
      "skip preserves history; schedule edits replace only pending; pause/resume/archive",
      async () => {
        const id = await save();
        await resolved(id, "skip");
        const hist = (await history(id)).history[0];
        assert.ok(hist.skipped_at);
        assert.equal(hist.completed_at, null);
        await save(
          { anchor_local_date: "2026-11-01", title: "Updated routine" },
          id,
        );
        assert.deepEqual(
          (await history(id)).history.find((o) => o.id === hist.id),
          hist,
        );
        const o = (await plan(id)).occurrence!;
        await pg.query("select set_care_plan_status($1,'paused')", [id]);
        await assert.rejects(
          pg.query("select complete_care_occurrence($1)", [o.id]),
        );
        await pg.query("select set_care_plan_status($1,'active')", [id]);
        assert.equal((await plan(id)).occurrence!.id, o.id);
        await pg.query("select set_care_plan_status($1,'archived')", [id]);
        assert.equal((await plan(id)).occurrence, null);
        assert.ok(
          (await history(id)).history.some((o) => o.status === "skipped"),
        );
        await assert.rejects(
          pg.query("select set_care_plan_status($1,'active')", [id]),
        );
        await pg.query("select complete_care_occurrence($1)", [o.id]);
        assert.equal((await plan(id)).occurrence, null);
        const paused = await save();
        await pg.query("select set_care_plan_status($1,'paused')", [paused]);
        await save({ anchor_local_date: "2026-12-01" }, paused);
        assert.equal((await plan(paused)).occurrence, null);
        await pg.query("select set_care_plan_status($1,'active')", [paused]);
        assert.match(
          new Date(
            (await plan(paused)).occurrence!.scheduled_for,
          ).toISOString(),
          /2026-12-02T01:00/,
        );
      },
    );
    await t.test(
      "snooze preserves scheduled time; bounded; notification dedupe and recipient isolation",
      async () => {
        const today = new Date().toISOString().slice(0, 10),
          id = await save({
            anchor_local_date: today,
            anchor_local_time: "00:00",
            time_zone: "UTC",
            reminders: [0],
          }),
          o = (await plan(id)).occurrence!;
        await role(undefined, true);
        assert.ok(
          Number(
            await val("select process_care_reminders(now(),500) as result"),
          ) > 0,
        );
        assert.equal(
          Number(
            await val("select process_care_reminders(now(),500) as result"),
          ),
          0,
        );
        await role(a);
        let n = await val<{ id: string; action_url: string }[]>(
          "select my_care_notifications() as result",
        );
        const own = n.find((n) => n.action_url === `/care/plans/${id}`)!;
        assert.ok(own);
        await role(b);
        assert.equal(
          (await val<unknown[]>("select my_care_notifications() as result"))
            .length,
          0,
        );
        await assert.rejects(
          pg.query("select mark_notification_read($1)", [own.id]),
        );
        await assert.rejects(
          pg.query("select snooze_care_occurrence($1,now()+interval '1 day')", [
            o.id,
          ]),
        );
        await role(a);
        await pg.query("select mark_notification_read($1,true)", [own.id]);
        await assert.rejects(
          pg.query(
            "select snooze_care_occurrence($1,now()+interval '40 days')",
            [o.id],
          ),
        );
        await pg.query(
          "select snooze_care_occurrence($1,now()+interval '1 day')",
          [o.id],
        );
        assert.equal(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          new Date(o.scheduled_for).toISOString(),
        );
        assert.ok((await plan(id)).occurrence!.snoozed_until);
        const fresh = await save({
          anchor_local_date: today,
          anchor_local_time: "00:00",
          time_zone: "UTC",
          reminders: [0],
        });
        const fo = (await plan(fresh)).occurrence!;
        await pg.query(
          "select snooze_care_occurrence($1,now()+interval '3 days')",
          [fo.id],
        );
        await role(undefined, true);
        await pg.query("select process_care_reminders(now(),500)");
        await role(a);
        n = await val("select my_care_notifications() as result");
        assert.ok(!n.some((n) => n.action_url === `/care/plans/${fresh}`));
        await role(undefined, true);
        await pg.query(
          "select process_care_reminders(now()+interval '4 days',500)",
        );
        await role(a);
        n = await val("select my_care_notifications() as result");
        assert.ok(n.some((n) => n.action_url === `/care/plans/${fresh}`));
        await resolved(fresh);
        assert.ok(
          !(
            await val<{ action_url: string }[]>(
              "select my_care_notifications() as result",
            )
          ).some((n) => n.action_url === `/care/plans/${fresh}`),
        );
      },
    );
    await t.test(
      "paused, completed, skipped and archived items do not notify; availability notifications remain valid",
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const ids: string[] = [];
        for (const action of ["paused", "archived", "complete", "skip"]) {
          const id = await save({
            anchor_local_date: today,
            anchor_local_time: "00:00",
            time_zone: "UTC",
            recurrence_type: "one_time",
            interval_value: null,
            interval_unit: null,
            reminders: [0],
          });
          ids.push(id);
          if (action === "complete" || action === "skip")
            await resolved(id, action);
          else
            await pg.query("select set_care_plan_status($1,$2)", [id, action]);
        }
        await role(undefined, true);
        await pg.query("select process_care_reminders(now(),500)");
        await role(a);
        assert.ok(
          !(
            await val<{ action_url: string }[]>(
              "select my_care_notifications() as result",
            )
          ).some((n) => ids.some((id) => n.action_url === `/care/plans/${id}`)),
        );
        await role();
        const notification = await val(
          "insert into notifications(user_id,type,title,body,action_url,dedupe_key) values($1,'availability_match','Opening found','Availability can change quickly.',$2,'test-availability') returning id as result",
          [a, `/openings/${randomUUID()}`],
        );
        await role(a);
        await pg.query("select mark_notification_read($1)", [notification]);
        await role();
        await assert.rejects(
          pg.query("update notifications set user_id=$1 where id=$2", [
            b,
            notification,
          ]),
        );
        await pg.exec("set role pawport_scheduling_worker");
        await assert.rejects(pg.exec("select process_care_reminders()"));
        await role(a);
      },
    );
    await t.test(
      "care limits serialize creation/resume; bounded owner DTOs and date-only 9 AM",
      async () => {
        const c = randomUUID();
        await role();
        await pg.query("insert into auth.users(id) values($1)", [c]);
        await role(c);
        const hc = await val(
          "insert into households(name) values('Limits') returning id as result",
        );
        const pc = await val(
          "insert into pets(household_id,name,species,breed,sex) values($1,'Milo','Cat','Mixed','Male') returning id as result",
          [hc],
        );
        await role();
        await pg.query(
          `insert into care_plans(household_id,pet_id,created_by,title,category,recurrence_type,interval_value,interval_unit,time_zone,anchor_local_date,created_at)
        select $1,$2,$3,'Routine '||n,'custom','interval',1,'day','UTC','2026-09-11',now()-interval '2 days' from generate_series(1,50) n`,
          [hc, pc, c],
        );
        await role(c);
        await assert.rejects(save({}, null, pc));
        const first = (await plans())[0];
        await pg.query("select set_care_plan_status($1,'paused')", [first.id]);
        const id = await save(
          {
            anchor_local_date: "2026-09-11",
            anchor_local_time: "",
            time_zone: "UTC",
          },
          null,
          pc,
        );
        assert.equal(
          new Date((await plan(id)).occurrence!.scheduled_for).toISOString(),
          "2026-09-11T09:00:00.000Z",
        );
        await assert.rejects(
          pg.query("select set_care_plan_status($1,'active')", [first.id]),
        );
        assert.equal(
          (
            await val<CarePlan[]>(
              "select my_care_plans(null,null,0,1) as result",
            )
          ).length,
          1,
        );
        assert.equal(
          (
            await val<CarePlan[]>(
              "select my_care_plans(null,$1,0,1) as result",
              [id],
            )
          )[0].id,
          id,
        );
        await role();
        assert.equal(
          (
            await pg.query(
              "select relname from pg_class where relname in ('care_plans','care_plan_occurrences','care_plan_reminders') and relrowsecurity",
            )
          ).rows.length,
          3,
        );
        await role(a);
      },
    );
    await t.test(
      "late worker keeps one visible offset and never changes notification recipient",
      async () => {
        const id = await save({
          time_zone: "UTC",
          anchor_local_date: new Date().toISOString().slice(0, 10),
          anchor_local_time: "00:00",
          reminders: [0, 120, 1440, 4320, 10080],
        });
        await role(undefined, true);
        await pg.query("select process_care_reminders(now(),500)");
        await role(a);
        const notices = await val<{ id: string; action_url: string }[]>(
          "select my_care_notifications() as result",
        );
        const own = notices.filter((n) => n.action_url === `/care/plans/${id}`);
        assert.equal(own.length, 1);
        await role();
        await assert.rejects(
          pg.query("update notifications set user_id=$1 where id=$2", [
            b,
            own[0].id,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update notifications set care_occurrence_id=$1 where id=$2",
            [randomUUID(), own[0].id],
          ),
        );
        await role(a);
      },
    );
  } finally {
    await pg.close();
  }
});
