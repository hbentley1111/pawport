import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("care calendar PostgreSQL ownership, lifecycle, reminders and additive isolation", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID(),
    provider = randomUUID();
  async function admin() {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub','',false)");
  }
  async function user(id: string | null) {
    await admin();
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    await pg.exec(id ? "set role authenticated" : "set role anon");
  }
  async function value<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const data = {
    title: "Annual visit",
    appointment_type: "veterinary",
    starts_at: "2027-09-22T17:30:00Z",
    ends_at: "2027-09-22T18:30:00Z",
    time_zone: "America/Los_Angeles",
    status: "scheduled",
    provider_name: "My vet",
    location_text: "Home",
    notes: "Private notes",
    google_place_id: "ChIJ-test",
  };
  try {
    await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    for (const file of [
      "202609110001_passport.sql",
      "202609110002_verified_records.sql",
      "202609110003_multi_pet_profiles.sql",
      "202609110004_local_services_reviews.sql",
    ])
      await pg.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await pg.query("insert into auth.users(id) values($1),($2),($3)", [
      a,
      b,
      provider,
    ]);
    const clinic = await value(
      "insert into public.veterinary_providers(name) values('Care test clinic') returning id as result",
    );
    await pg.query(
      "insert into public.provider_memberships(provider_id,user_id,active) values($1,$2,true)",
      [clinic, provider],
    );
    await user(a);
    const household = await value(
      "insert into public.households(name) values('A') returning id as result",
    );
    const pet = await value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'Milo','Dog','Mixed','Male') returning id as result",
      [household],
    );
    const pet2 = await value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'Luna','Cat','Mixed','Female') returning id as result",
      [household],
    );
    await pg.query(
      "insert into public.vaccinations(pet_id,name,administered_on,clinic) values($1,'Rabies','2025-01-01','Clinic')",
      [pet],
    );
    const pass = await value<{ token: string }>(
      "select public.create_share_pass($1,24) as result",
      [pet],
    );
    await user(b);
    const householdB = await value(
      "insert into public.households(name) values('B') returning id as result",
    );
    const petB = await value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'B pet','Dog','Mixed','Male') returning id as result",
      [householdB],
    );
    await admin();
    const policies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    const tables = [
      "pets",
      "households",
      "vaccinations",
      "share_passes",
      "health_documents",
      "verification_requests",
      "health_audit_events",
      "service_reviews",
    ];
    const before = new Map();
    for (const name of tables)
      before.set(
        name,
        (
          await pg.query(
            `select to_jsonb(t) from public.${name} t order by to_jsonb(t)::text`,
          )
        ).rows,
      );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110005_care_calendar.sql",
        "utf8",
      ),
    );
    await t.test(
      "migration preserves existing rows, medical/storage policies and share links",
      async () => {
        for (const name of tables)
          assert.deepEqual(
            (
              await pg.query(
                `select to_jsonb(t) from public.${name} t order by to_jsonb(t)::text`,
              )
            ).rows,
            before.get(name),
          );
        assert.deepEqual(
          (
            await pg.query(
              "select * from pg_policies where tablename not in ('appointments','appointment_reminders') order by schemaname,tablename,policyname",
            )
          ).rows,
          policies,
        );
        await user(null);
        assert.ok(
          await value("select public.read_share_pass($1) as result", [
            pass.token,
          ]),
        );
      },
    );
    let appointment: string, second: string, reminder: string;
    const save = (
      id: string | null,
      p: string,
      body: object = data,
      reminders: number[] = [1440, 120],
    ) =>
      value(
        "select public.save_manual_appointment($1,$2,$3,$4::integer[]) as result",
        [id, p, body, reminders],
      );
    await t.test(
      "creates appointments for separate pets with server-derived identity and in-app reminders",
      async () => {
        await user(a);
        appointment = await save(null, pet);
        second = await save(null, pet2);
        const rows = (
          await pg.query<{
            household_id: string;
            created_by: string;
            source: string;
          }>("select * from public.appointments order by pet_id")
        ).rows;
        assert.equal(rows.length, 2);
        for (const row of rows) {
          assert.equal(row.household_id, household);
          assert.equal(row.created_by, a);
          assert.equal(row.source, "manual");
        }
        reminder = await value(
          "select id as result from public.appointment_reminders where appointment_id=$1 limit 1",
          [appointment],
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointment_reminders",
          ),
          4,
        );
      },
    );
    await t.test(
      "cross-user, anonymous and provider access are denied; identity cannot be spoofed",
      async () => {
        await user(b);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointments",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointment_reminders",
          ),
          0,
        );
        await assert.rejects(() => save(null, pet));
        await assert.rejects(() => save(appointment, petB));
        await assert.rejects(() =>
          pg.query("select public.cancel_manual_appointment($1)", [
            appointment,
          ]),
        );
        await assert.rejects(() =>
          pg.query("select public.dismiss_appointment_reminder($1)", [
            reminder,
          ]),
        );
        await user(a);
        await assert.rejects(() => save(null, pet, { ...data, created_by: b }));
        await assert.rejects(() =>
          save(null, pet, { ...data, household_id: householdB }),
        );
        await assert.rejects(() =>
          save(null, pet, { ...data, source: "external" }),
        );
        await assert.rejects(() => save(appointment, pet2));
        await assert.rejects(() =>
          pg.query("update public.appointments set pet_id=$1 where id=$2", [
            pet2,
            appointment,
          ]),
        );
        await assert.rejects(() =>
          pg.query("delete from public.appointments where id=$1", [
            appointment,
          ]),
        );
        await assert.rejects(() =>
          pg.query(
            "update public.appointment_reminders set sent_at=now() where id=$1",
            [reminder],
          ),
        );
        await user(provider);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointments",
          ),
          0,
        );
        await assert.rejects(() => save(null, pet));
        await user(null);
        await assert.rejects(() =>
          pg.query("select * from public.appointments"),
        );
        await assert.rejects(() => save(null, pet));
      },
    );
    await t.test(
      "database trigger rejects mismatched household/pet/creator and reminder ownership even for privileged writes",
      async () => {
        await admin();
        await assert.rejects(() =>
          pg.query(
            "insert into public.appointments(household_id,pet_id,created_by,title,appointment_type,starts_at) values($1,$2,$3,'bad','other',now())",
            [householdB, pet, a],
          ),
        );
        await assert.rejects(() =>
          pg.query(
            "insert into public.appointments(household_id,pet_id,created_by,title,appointment_type,starts_at) values($1,$2,$3,'bad','other',now())",
            [household, pet, b],
          ),
        );
        await assert.rejects(() =>
          pg.query(
            "update public.appointments set household_id=$1,pet_id=$2,created_by=$3 where id=$4",
            [householdB, petB, b, appointment],
          ),
        );
        await assert.rejects(() =>
          pg.query(
            "insert into public.appointment_reminders(appointment_id,user_id,reminder_minutes) values($1,$2,10080)",
            [appointment, b],
          ),
        );
      },
    );
    await t.test(
      "edits are atomic, rescheduling resets dismissed reminders, cancellation preserves private history",
      async () => {
        await user(a);
        await pg.query("select public.dismiss_appointment_reminder($1)", [
          reminder,
        ]);
        assert.ok(
          await value(
            "select dismissed_at as result from public.appointment_reminders where id=$1",
            [reminder],
          ),
        );
        await save(appointment, pet, {
          ...data,
          title: "Changed",
          starts_at: "2027-10-02T14:00:00Z",
          ends_at: null,
        });
        assert.equal(
          await value(
            "select dismissed_at as result from public.appointment_reminders where id=$1",
            [reminder],
          ),
          null,
        );
        await save(
          second,
          pet2,
          {
            ...data,
            starts_at: "2020-01-01T12:00:00Z",
            ends_at: null,
            status: "completed",
          },
          [],
        );
        await pg.query("select public.cancel_manual_appointment($1)", [
          appointment,
        ]);
        assert.equal(
          await value(
            "select status as result from public.appointments where id=$1",
            [appointment],
          ),
          "cancelled",
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointments",
          ),
          2,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointment_reminders where appointment_id=$1",
            [second],
          ),
          0,
        );
        await user(b);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.appointments",
          ),
          0,
        );
      },
    );
    await t.test(
      "SQL enforces types, timestamps, lengths, Place IDs and reminder allowlists",
      async () => {
        await user(a);
        for (const change of [
          { appointment_type: "made_up" },
          { status: "booked_by_pawport" },
          { google_place_id: "../bad" },
          { google_place_id: "x".repeat(256) },
          { title: "" },
          { notes: "x".repeat(2001) },
          { starts_at: "infinity" },
          { ends_at: "2000-01-01Z" },
          { time_zone: "Invalid/zone" },
        ])
          await assert.rejects(() => save(null, pet, { ...data, ...change }));
        await assert.rejects(() => save(null, pet, data, [1]));
        await assert.rejects(() => save(null, pet, data, [120, 120]));
      },
    );
    await t.test(
      "external identities are connection-scoped and unavailable to manual mutation RPCs",
      async () => {
        await admin();
        const connection = randomUUID();
        const sql =
          "insert into public.appointments(household_id,pet_id,created_by,source,external_system,external_connection_id,external_appointment_id,title,appointment_type,starts_at) values($1,$2,$3,'external','test-connector',$4,'external-1','Imported fixture','other','2027-01-01T12:00:00Z') returning id as result";
        const imported = await value(sql, [household, pet, a, connection]);
        await assert.rejects(() => value(sql, [household, pet, a, connection]));
        await user(a);
        await assert.rejects(() => save(imported, pet));
        await assert.rejects(() =>
          pg.query("select public.cancel_manual_appointment($1)", [imported]),
        );
      },
    );
  } finally {
    await pg.close();
  }
});
