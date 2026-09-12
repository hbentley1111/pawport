import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { WorkerWatch } from "../lib/openings/schema";
import {
  processAvailabilityWatch,
  type AvailabilityStore,
} from "../lib/openings/processor";
import { MockSchedulingAdapter } from "../lib/scheduling/mock";
import type { AvailabilitySlot } from "../lib/care/scheduling-adapter";
test("Smart Openings PostgreSQL ownership, lifecycle, notifications and generic mock pipeline", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID(),
    provider = randomUUID();
  async function role(id?: string, worker = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (worker) await pg.exec("set role pawport_scheduling_worker");
    else if (id) await pg.exec("set role authenticated");
  }
  async function value<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const later = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString(),
    date = (days: number) => later(days).slice(0, 10);
  const env = { ...process.env };
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
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    await pg.query("insert into auth.users(id) values($1),($2),($3)", [
      a,
      b,
      provider,
    ]);
    await role(a);
    const ha = await value(
      "insert into households(name) values('A') returning id as result",
    );
    const pet = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    const pet2 = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jasper','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    await role(b);
    const hb = await value(
      "insert into households(name) values('B') returning id as result",
    );
    const petB = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'B','Cat','Mixed','Female') returning id as result",
      [hb],
    );
    await role();
    const clinic = await value(
      "insert into veterinary_providers(name) values('Demo clinic') returning id as result",
    );
    await pg.query(
      "insert into provider_memberships(provider_id,user_id) values($1,$2)",
      [clinic, provider],
    );
    const c = await value(
      "insert into provider_connections(provider_id,connection_type,external_system,status) values($1,'veterinary','mock','active') returning id as result",
      [clinic],
    );
    const c2 = await value(
      "insert into provider_connections(google_place_id,connection_type,external_system,status) values('ChIJ-other','grooming','mock','active') returning id as result",
    );
    await pg.query(
      "insert into provider_scheduling_permissions(connection_id,user_id,role) values($1,$2,'provider_admin')",
      [c, provider],
    );
    await role(undefined, true);
    const mapping = await value(
      "select propose_external_pet_mapping($1,$2,$3,null) as result",
      [c, pet, "demo-pet"],
    );
    const mapping2 = await value(
      "select propose_external_pet_mapping($1,$2,$3,null) as result",
      [c, pet2, "demo-pet2"],
    );
    await role(a);
    for (const m of [mapping, mapping2])
      await pg.query("select decide_external_pet_mapping($1,'confirmed')", [m]);
    await role(undefined, true);
    await pg.query("select import_scheduling_event($1,$2)", [
      c,
      {
        event_id: "appointment-event",
        kind: "upsert",
        external_id: "visit",
        external_pet_id: "demo-pet",
        version: 1,
        title: "Existing appointment",
        appointment_type: "veterinary",
        starts_at: later(20),
        ends_at: null,
        status: "scheduled",
      },
    ]);
    await role(a);
    const appointment = await value(
      "select id as result from appointments where source='external'",
    );
    await role();
    const oldPolicies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    const original = (
      await pg.query("select to_jsonb(a) as row from appointments a")
    ).rows;
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110007_smart_openings.sql",
        "utf8",
      ),
    );
    // Exercise the complete existing availability pipeline after the additive care notification extension.
    await pg.exec(
      await readFile("supabase/migrations/202609110008_care_plans.sql", "utf8"),
    );
    for (const f of ["009_pet_timeline", "010_pawport_today"])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    const data = {
      earliest_date: date(1),
      latest_date: date(19),
      earliest_time: "",
      latest_time: "",
      allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
      time_zone: "UTC",
    };
    const save = (
      id: string | null = null,
      p = pet,
      conn = c,
      apt: string | null = appointment,
      d: Record<string, unknown> = data,
    ) =>
      value("select save_availability_watch($1,$2,$3,$4,$5) as result", [
        id,
        p,
        conn,
        apt,
        d,
      ]);
    let wid: string;
    let mid: string;
    let nid: string;
    const begin = () =>
      value<WorkerWatch | null>(
        "select begin_availability_check($1) as result",
        [wid],
      );
    const slot: AvailabilitySlot = {
      externalSlotId: "slot-A",
      connectionId: c,
      startsAt: later(7),
      endsAt: later(7.01),
      appointmentType: "veterinary",
      bookable: true,
    };
    const complete = (
      token: string,
      slots: AvailabilitySlot[],
      error = false,
    ) =>
      value<number>(
        "select complete_availability_check($1,$2,$3,$4) as result",
        [wid, token, slots, error],
      );
    await t.test(
      "migration preserves existing appointments and policies; no capability or demo is enabled by default",
      async () => {
        assert.deepEqual(
          (
            await pg.query(
              "select * from pg_policies order by schemaname,tablename,policyname",
            )
          ).rows,
          oldPolicies,
        );
        assert.deepEqual(
          (await pg.query("select to_jsonb(a) as row from appointments a"))
            .rows,
          original,
        );
        await role(a);
        await assert.rejects(save());
        assert.equal(
          await value("select availability_appointment_context($1) as result", [
            appointment,
          ]),
          null,
        );
        await role(undefined, true);
        await assert.rejects(
          pg.query("select set_availability_capability($1,true)", [c]),
        );
        await role();
        await pg.exec(
          "update availability_runtime_settings set demo_enabled=true",
        );
        await role(undefined, true);
        await pg.query("select set_availability_capability($1,true)", [c]);
      },
    );
    await t.test(
      "owner creates own watch; recipient, connection and appointment cannot be spoofed",
      async () => {
        await role(a);
        wid = await save();
        assert.ok(wid);
        await assert.rejects(save());
        await assert.rejects(save(null, petB));
        await assert.rejects(save(null, pet2));
        await assert.rejects(save(null, pet, c2));
        await assert.rejects(save(null, pet, c, randomUUID()));
        await assert.rejects(
          save(null, pet, c, appointment, { ...data, created_by: b }),
        );
        await assert.rejects(
          save(null, pet, c, null, { ...data, latest_date: date(91) }),
        );
        await assert.rejects(
          save(null, pet, c, null, {
            ...data,
            earliest_time: "18:00",
            latest_time: "09:00",
          }),
        );
        const rows = await value<Record<string, unknown>[]>(
          "select my_availability_watches() as result",
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].pet_name, "Jaxson");
        assert.doesNotMatch(
          JSON.stringify(rows),
          /external_slot_id|external_owner_id|process_token|credential_ref/,
        );
        await role(b);
        assert.deepEqual(
          await value("select my_availability_watches() as result"),
          [],
        );
        await assert.rejects(save(wid));
        await assert.rejects(
          pg.query("select set_availability_watch_status($1,'cancelled')", [
            wid,
          ]),
        );
        await role(provider);
        assert.deepEqual(
          await value("select my_availability_watches() as result"),
          [],
        );
        await assert.rejects(save());
        for (const id of [a, b, provider]) {
          await role(id);
          for (const table of [
            "availability_watches",
            "availability_matches",
            "notifications",
          ]) {
            await assert.rejects(pg.query(`select * from ${table}`));
            await assert.rejects(
              pg.query(`insert into ${table} default values`),
            );
            await assert.rejects(pg.query(`delete from ${table}`));
          }
          await assert.rejects(begin());
          await assert.rejects(complete(randomUUID(), [slot]));
        }
        await role();
        await pg.exec("set role anon");
        await assert.rejects(pg.query("select my_availability_watches()"));
        await assert.rejects(
          pg.query("select my_availability_notifications()"),
        );
        await assert.rejects(save());
        await role();
        await assert.rejects(
          pg.query(
            "update availability_watches set household_id=$2,pet_id=$3,created_by=$4 where id=$1",
            [wid, hb, petB, b],
          ),
        );
        await assert.rejects(
          pg.query(
            "update availability_watches set connection_id=$2 where id=$1",
            [wid, c2],
          ),
        );
        await assert.rejects(
          pg.query(
            "update availability_watches set expires_at=created_at+interval '91 days' where id=$1",
            [wid],
          ),
        );
      },
    );
    await t.test(
      "worker matching is defensive and notifications deduplicate across polls, disappearance and return",
      async () => {
        await role(undefined, true);
        let work = await begin();
        assert.ok(work);
        assert.equal(await begin(), null);
        await assert.rejects(
          complete(work.process_token, [{ ...slot, connectionId: c2 }]),
        );
        assert.equal(
          await complete(work.process_token, [{ ...slot, bookable: false }]),
          0,
        );
        work = await begin();
        assert.ok(work);
        assert.equal(await complete(work.process_token, [slot, slot]), 1);
        await role(a);
        const notifications = await value<{ id: string; title: string }[]>(
          "select my_availability_notifications() as result",
        );
        assert.equal(notifications.length, 1);
        nid = notifications[0].id;
        await role();
        await assert.rejects(
          pg.query("update notifications set user_id=$2 where id=$1", [nid, b]),
        );
        await role(a);
        assert.match(notifications[0].title, /Demo/);
        const watches = await value<
          { matches: { id: string; status: string }[] }[]
        >("select my_availability_watches() as result");
        mid = watches[0].matches[0].id;
        const todayOpening = await value<{
          count: number;
          items: { id: string; subtitle: string }[];
        }>("select my_today_openings(array['mock']) as result");
        assert.equal(todayOpening.count, 1);
        assert.equal(todayOpening.items[0].id, `opening:${mid}`);
        assert.match(
          todayOpening.items[0].subtitle,
          /Availability can change quickly/,
        );
        assert.equal(
          (
            await value<{ count: number }>(
              "select my_today_openings() as result",
            )
          ).count,
          0,
        );
        assert.equal(
          await value("select my_notification_count(false) as result"),
          0,
        );
        assert.equal(
          await value("select my_notification_count(true) as result"),
          1,
        );
        const safeNotices = await value<{ notifications: { type: string }[] }>(
          "select my_notifications(false,null,null,25,true) as result",
        );
        assert.equal(safeNotices.notifications[0].type, "availability_match");
        assert.doesNotMatch(
          JSON.stringify(safeNotices),
          /external_slot_id|credential_ref|connection_id|dedupe_key/,
        );
        assert.equal(watches[0].matches[0].status, "notified");
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        assert.equal(await complete(work.process_token, [slot]), 0);
        work = await begin();
        assert.ok(work);
        await complete(work.process_token, []);
        await role(a);
        assert.equal(
          (
            await value<{ matches: { status: string }[] }[]>(
              "select my_availability_watches() as result",
            )
          )[0].matches[0].status,
          "unavailable",
        );
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        assert.equal(await complete(work.process_token, [slot]), 0);
        await role(b);
        assert.deepEqual(
          await value("select my_availability_notifications() as result"),
          [],
        );
        await assert.rejects(
          pg.query("select dismiss_availability_match($1)", [mid]),
        );
        await assert.rejects(
          pg.query("select mark_notification_read($1)", [nid]),
        );
        await role(a);
        await pg.query("select mark_notification_read($1)", [nid]);
        await pg.query("select dismiss_availability_match($1)", [mid]);
        assert.equal(
          (
            await value<{ count: number }>(
              "select my_today_openings(array['mock']) as result",
            )
          ).count,
          0,
        );
        assert.ok(
          (
            await value<{ dismissed_at: string }[]>(
              "select my_availability_notifications() as result",
            )
          )[0].dismissed_at,
        );
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        await complete(work.process_token, [slot]);
        await role(a);
        assert.equal(
          (
            await value<{ matches: { status: string }[] }[]>(
              "select my_availability_watches() as result",
            )
          )[0].matches[0].status,
          "dismissed",
        );
        assert.equal(
          (
            await value<unknown[]>(
              "select my_availability_notifications() as result",
            )
          ).length,
          1,
        );
      },
    );
    await t.test(
      "edits invalidate in-flight results; paused/error/cancelled watches never receive late notifications",
      async () => {
        await role(undefined, true);
        let work = await begin();
        assert.ok(work);
        await role(a);
        await save(wid, pet, c, appointment, {
          ...data,
          allowed_weekdays: [1],
        });
        await role(undefined, true);
        assert.equal(
          await complete(work.process_token, [
            { ...slot, externalSlotId: "late" },
          ]),
          0,
        );
        await role(a);
        await save(wid);
        await pg.query("select set_availability_watch_status($1,'paused')", [
          wid,
        ]);
        await role(undefined, true);
        assert.equal(await begin(), null);
        await role(a);
        await pg.query("select set_availability_watch_status($1,'active')", [
          wid,
        ]);
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        await complete(work.process_token, [], true);
        await role(a);
        assert.equal(
          (
            await value<{ status: string }[]>(
              "select my_availability_watches() as result",
            )
          )[0].status,
          "connection_unavailable",
        );
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        await complete(work.process_token, []);
        await role(provider);
        await pg.query("select set_scheduling_connection_status($1,'paused')", [
          c,
        ]);
        await role(a);
        assert.equal(
          (
            await value<{ status: string }[]>(
              "select my_availability_watches() as result",
            )
          )[0].status,
          "connection_unavailable",
        );
        await role(undefined, true);
        assert.equal(await begin(), null);
        await role(provider);
        await pg.query("select set_scheduling_connection_status($1,'active')", [
          c,
        ]);
        Object.assign(process.env, {
          NODE_ENV: "test",
          PAWPORT_ENABLE_MOCK_SCHEDULING: "true",
        });
        delete process.env.VERCEL_ENV;
        const adapter = new MockSchedulingAdapter(c);
        adapter.setAvailability({ id: c, externalSystem: "mock" }, [
          { ...slot, externalSlotId: "pipeline" },
        ]);
        const store: AvailabilityStore = {
          begin: async () => {
            await role(undefined, true);
            return begin();
          },
          complete: async (_, token, slots, error) => {
            await role(undefined, true);
            return complete(token, slots, error);
          },
        };
        assert.equal(
          (await processAvailabilityWatch(wid, store, () => adapter))
            .newNotifications,
          1,
        );
        await role(undefined, true);
        work = await begin();
        assert.ok(work);
        await role(a);
        await pg.query("select set_availability_watch_status($1,'cancelled')", [
          wid,
        ]);
        await role(undefined, true);
        assert.equal(
          await complete(work.process_token, [
            { ...slot, externalSlotId: "after-cancel" },
          ]),
          0,
        );
        await role(a);
        assert.equal(
          (
            await value<{ status: string }[]>(
              "select my_availability_watches() as result",
            )
          )[0].status,
          "cancelled",
        );
      },
    );
    await t.test(
      "expiry and permanent connection revocation retain history and suppress processing",
      async () => {
        await role(a);
        wid = await save(null, pet, c, appointment, {
          ...data,
          earliest_date: date(0),
        });
        await role(undefined, true);
        const pending = await begin();
        assert.ok(pending);
        await role();
        await pg.query(
          "update availability_watches set expires_at=created_at+interval '1 millisecond' where id=$1",
          [wid],
        );
        await role(undefined, true);
        assert.equal(await begin(), null);
        assert.equal(
          await complete(pending.process_token, [
            { ...slot, externalSlotId: "after-expiry" },
          ]),
          0,
        );
        await role(a);
        assert.equal(
          (
            await value<{ id: string; status: string }[]>(
              "select my_availability_watches() as result",
            )
          ).find((w) => w.id === wid)?.status,
          "expired",
        );
        wid = await save();
        await role(provider);
        await pg.query(
          "select set_scheduling_connection_status($1,'revoked')",
          [c],
        );
        await role(undefined, true);
        assert.equal(await begin(), null);
        await role(a);
        assert.equal(
          (
            await value<{ id: string; status: string }[]>(
              "select my_availability_watches() as result",
            )
          ).find((w) => w.id === wid)?.status,
          "expired",
        );
        const originalAfter = (
          await pg.query<{ title: string; starts_at: string; status: string }>(
            "select title,starts_at,status from appointments where id=$1",
            [appointment],
          )
        ).rows[0];
        assert.equal(originalAfter.title, "Existing appointment");
        assert.equal(originalAfter.status, "scheduled");
      },
    );
  } finally {
    for (const key of [
      "NODE_ENV",
      "PAWPORT_ENABLE_MOCK_SCHEDULING",
      "VERCEL_ENV",
    ]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await pg.close();
  }
});
