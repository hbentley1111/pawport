import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { MockSchedulingAdapter } from "../lib/scheduling/mock";
import {
  ingestWebhook,
  syncAppointments,
  type SchedulingStore,
} from "../lib/scheduling/pipeline";
import type { SchedulingEvent } from "../lib/care/scheduling-adapter";
test("scheduling PostgreSQL authorization and end-to-end mock import pipeline", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID(),
    verifier = randomUUID(),
    manager = randomUUID();
  async function role(id?: string, worker = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (worker) await pg.exec("set role pawport_scheduling_worker");
    else if (id) await pg.exec("set role authenticated");
  }
  async function scalar<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    PAWPORT_ENABLE_MOCK_SCHEDULING: process.env.PAWPORT_ENABLE_MOCK_SCHEDULING,
  };
  try {
    await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    for (const f of [
      "001_passport",
      "002_verified_records",
      "003_multi_pet_profiles",
      "004_local_services_reviews",
      "005_care_calendar",
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    await pg.query("insert into auth.users(id) values($1),($2),($3),($4)", [
      a,
      b,
      verifier,
      manager,
    ]);
    const provider = await scalar(
      "insert into veterinary_providers(name) values('Fictional clinic') returning id as result",
    );
    await pg.query(
      "insert into provider_memberships(provider_id,user_id) values($1,$2)",
      [provider, verifier],
    );
    await role(a);
    const ha = await scalar(
      "insert into households(name) values('A') returning id as result",
    );
    const pet = await scalar(
      "insert into pets(household_id,name,species,breed,sex) values($1,'A pet','Dog','Mix','Male') returning id as result",
      [ha],
    );
    const manual = await scalar(
      "select save_manual_appointment(null,$1,$2,'{}') as result",
      [
        pet,
        {
          title: "Manual",
          appointment_type: "other",
          starts_at: "2027-01-01T12:00:00Z",
          time_zone: "UTC",
          status: "scheduled",
        },
      ],
    );
    await role(b);
    const hb = await scalar(
      "insert into households(name) values('B') returning id as result",
    );
    const petB = await scalar(
      "insert into pets(household_id,name,species,breed,sex) values($1,'B pet','Cat','Mix','Female') returning id as result",
      [hb],
    );
    await role();
    const policies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    const appointmentBefore = (
      await pg.query("select id,pet_id,source,title from appointments")
    ).rows;
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110006_scheduling_connections.sql",
        "utf8",
      ),
    );
    const c = await scalar(
      "insert into provider_connections(provider_id,connection_type,external_system,status) values($1,'veterinary','mock','pending') returning id as result",
      [provider],
    );
    const cb = await scalar(
      "insert into provider_connections(google_place_id,connection_type,external_system,status,credential_ref) values('ChIJ-b','grooming','moego','active','vault/PRIVATE_REF') returning id as result",
    );
    await pg.query(
      "insert into provider_scheduling_permissions(connection_id,user_id,role) values($1,$2,'scheduling_manager')",
      [c, manager],
    );
    let mapping: string, appointment: string;
    const event: SchedulingEvent = {
      event_id: "event-1",
      kind: "upsert",
      external_id: "visit-1",
      external_pet_id: "demo-pet",
      version: 1,
      title: "Imported care",
      appointment_type: "veterinary",
      starts_at: "2027-10-10T14:00:00Z",
      ends_at: null,
      status: "scheduled",
    };
    const importEvent = async (e: SchedulingEvent, connection = c) =>
      scalar("select import_scheduling_event($1,$2) as result", [
        connection,
        e,
      ]);
    await t.test(
      "existing appointment data and all RLS policies are unchanged",
      async () => {
        assert.deepEqual(
          (
            await pg.query(
              "select * from pg_policies order by schemaname,tablename,policyname",
            )
          ).rows,
          policies,
        );
        assert.deepEqual(
          (await pg.query("select id,pet_id,source,title from appointments"))
            .rows,
          appointmentBefore,
        );
      },
    );
    await t.test(
      "anonymous, owners and verifiers cannot read raw tables, manage arbitrary connections or import",
      async () => {
        for (const id of [a, b, verifier]) {
          await role(id);
          assert.deepEqual(
            await scalar("select my_scheduling_connections() as result"),
            [],
          );
          await assert.rejects(
            pg.query("select set_scheduling_connection_status($1,'active')", [
              c,
            ]),
          );
          await assert.rejects(importEvent(event));
          await assert.rejects(
            pg.query("select propose_external_pet_mapping($1,$2,$3,null)", [
              c,
              pet,
              "spoof",
            ]),
          );
          for (const table of [
            "provider_connections",
            "provider_scheduling_permissions",
            "external_pet_mappings",
            "provider_sync_events",
            "external_appointment_state",
            "external_appointment_aliases",
          ]) {
            await assert.rejects(pg.query(`select * from ${table}`));
            await assert.rejects(pg.query(`delete from ${table}`));
          }
        }
        await role();
        await pg.exec("set role anon");
        await assert.rejects(pg.query("select my_scheduling_connections()"));
        await assert.rejects(pg.query("select my_external_pet_mappings()"));
        await assert.rejects(importEvent(event));
      },
    );
    await t.test(
      "worker proposals derive household; mapping requires explicit owner confirmation",
      async () => {
        await role(undefined, true);
        mapping = await scalar(
          "select propose_external_pet_mapping($1,$2,$3,$4) as result",
          [c, pet, "demo-pet", "customer-a"],
        );
        await pg.query("select validate_scheduling_connection($1)", [c]);
        assert.equal(await importEvent(event), "mapping_required");
        await role(a);
        assert.equal(
          await scalar<number>(
            "select count(*)::int as result from appointments where source='external'",
          ),
          0,
        );
        const summary = await scalar<Record<string, unknown>[]>(
          "select my_scheduling_connections() as result",
        );
        assert.equal(summary.length, 1);
        assert.equal(summary[0].can_manage, false);
        assert.doesNotMatch(
          JSON.stringify(summary),
          /credential|external_account|external_location|PRIVATE_REF/,
        );
        await role(b);
        assert.deepEqual(
          await scalar("select my_scheduling_connections() as result"),
          [],
        );
        assert.deepEqual(
          await scalar("select my_external_pet_mappings() as result"),
          [],
        );
        await assert.rejects(
          pg.query("select decide_external_pet_mapping($1,'confirmed')", [
            mapping,
          ]),
        );
        await role(manager);
        assert.deepEqual(
          await scalar("select my_external_pet_mappings() as result"),
          [],
        );
        await assert.rejects(
          pg.query("select decide_external_pet_mapping($1,'confirmed')", [
            mapping,
          ]),
        );
        await role();
        await assert.rejects(
          pg.query(
            "insert into external_pet_mappings(connection_id,household_id,pet_id,external_pet_id) values($1,$2,$3,'mismatch')",
            [c, ha, petB],
          ),
        );
        await assert.rejects(
          pg.query(
            "update external_pet_mappings set pet_id=$2,household_id=$3 where id=$1",
            [mapping, petB, hb],
          ),
        );
        await role(a);
        await pg.query("select decide_external_pet_mapping($1,'confirmed')", [
          mapping,
        ]);
        await role(undefined, true);
        assert.equal(await importEvent(event), "processed");
        assert.equal(await importEvent(event), "duplicate");
        await role(a);
        appointment = await scalar(
          "select id as result from appointments where source='external'",
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int as result from appointments where source='external'",
          ),
          1,
        );
        await role(b);
        assert.equal(
          await scalar<number>(
            "select count(*)::int as result from appointments",
          ),
          0,
        );
      },
    );
    await t.test(
      "idempotent updates, replacement IDs, older events and tombstones preserve one immutable appointment",
      async () => {
        await role(undefined, true);
        await assert.rejects(
          importEvent({ ...event, title: "Changed duplicate" }),
        );
        assert.equal(
          await importEvent({
            ...event,
            event_id: "reschedule",
            version: 3,
            starts_at: "2027-11-01T14:00:00Z",
          }),
          "processed",
        );
        assert.equal(
          await importEvent({ ...event, event_id: "older", version: 2 }),
          "out_of_order",
        );
        assert.equal(
          await importEvent({
            ...event,
            event_id: "replacement",
            external_id: "visit-new",
            replaces_id: "visit-1",
            version: 4,
          }),
          "processed",
        );
        assert.equal(
          await importEvent({
            event_id: "delete",
            kind: "tombstone",
            external_id: "visit-new",
            external_pet_id: "demo-pet",
            version: 5,
          }),
          "processed",
        );
        assert.equal(
          await importEvent({ ...event, event_id: "late", version: 4 }),
          "out_of_order",
        );
        await role(a);
        const row = (
          await pg.query<{
            id: string;
            status: string;
            external_appointment_id: string;
            pet_id: string;
          }>(
            "select id,status,external_appointment_id,pet_id from appointments where id=$1",
            [appointment],
          )
        ).rows[0];
        assert.equal(row.status, "cancelled");
        assert.equal(row.external_appointment_id, "visit-1");
        assert.equal(row.pet_id, pet);
        await assert.rejects(
          pg.query("select cancel_manual_appointment($1)", [appointment]),
        );
        await assert.rejects(
          pg.query("update appointments set title='hacked' where id=$1", [
            appointment,
          ]),
        );
        await assert.rejects(
          pg.query("select save_manual_appointment($1,$2,$3,'{}')", [
            appointment,
            pet,
            {
              title: "hack",
              starts_at: "2027-01-01Z",
              time_zone: "UTC",
              appointment_type: "other",
              status: "scheduled",
            },
          ]),
        );
        await role();
        await assert.rejects(
          pg.query(
            "update appointments set household_id=$2,pet_id=$3,created_by=$4 where id=$1",
            [appointment, hb, petB, b],
          ),
        );
      },
    );
    await t.test(
      "connection-scoped mapping prevents cross-connection injection and external ID cannot change pets",
      async () => {
        await role(undefined, true);
        assert.equal(
          await importEvent({ ...event, event_id: "other-connection" }, cb),
          "mapping_required",
        );
        const mb = await scalar(
          "select propose_external_pet_mapping($1,$2,$3,null) as result",
          [c, petB, "other-pet"],
        );
        await role(b);
        await pg.query("select decide_external_pet_mapping($1,'confirmed')", [
          mb,
        ]);
        await role(undefined, true);
        await assert.rejects(
          importEvent({
            ...event,
            event_id: "move",
            external_pet_id: "other-pet",
            version: 7,
          }),
        );
        await assert.rejects(
          pg.query(
            "select propose_external_pet_mapping($1,$2,'demo-pet',null)",
            [c, petB],
          ),
        );
      },
    );
    await t.test(
      "mock verifies before ingest, imports through worker path, and supports updates, cancellation, duplicates",
      async () => {
        Object.assign(process.env, {
          NODE_ENV: "test",
          PAWPORT_ENABLE_MOCK_SCHEDULING: "true",
        });
        const connection = { id: c, externalSystem: "mock" as const },
          adapter = new MockSchedulingAdapter(c);
        const store: SchedulingStore = {
          recordRun: async (id, success) => {
            await role(undefined, true);
            await pg.query("select record_scheduling_run($1,$2)", [
              id,
              success,
            ]);
          },
          importEvent: async (id, e) => {
            await role(undefined, true);
            return importEvent(e, id);
          },
          recordFailure: async (id, code) => {
            await role(undefined, true);
            await pg.query("select record_scheduling_failure($1,$2)", [
              id,
              code,
            ]);
          },
        };
        const results = await syncAppointments(
          adapter,
          connection,
          { from: "2027-01-01Z", to: "2028-01-01Z" },
          store,
        );
        assert.deepEqual(results, ["processed"]);
        adapter.updateAppointment(connection, "demo-visit", {
          starts_at: "2027-11-01T15:00:00Z",
          ends_at: null,
        });
        const updated = await adapter.getAppointment(connection, "demo-visit");
        const e = adapter.normalizeAppointment(updated, "mock-update");
        const signed = adapter.signDemoEvent(connection, e);
        assert.equal(
          await ingestWebhook(adapter, connection, signed, store),
          "processed",
        );
        assert.equal(
          await ingestWebhook(adapter, connection, signed, store),
          "duplicate",
        );
        await adapter.cancelAppointment(connection, "demo-visit");
        await syncAppointments(
          adapter,
          connection,
          { from: "2027-01-01Z", to: "2028-01-01Z" },
          store,
        );
        await role(a);
        assert.equal(
          await scalar(
            "select status as result from appointments where external_appointment_id='demo-visit'",
          ),
          "cancelled",
        );
      },
    );
    await t.test(
      "tombstone before creation blocks old creates and health recovery requires worker validation",
      async () => {
        await role(undefined, true);
        const tomb = {
          event_id: "early-tomb",
          kind: "tombstone" as const,
          external_id: "not-yet-created",
          external_pet_id: "demo-pet",
          version: 4,
        };
        assert.equal(await importEvent(tomb), "processed");
        assert.equal(
          await importEvent({
            ...event,
            event_id: "late-create",
            external_id: tomb.external_id,
            version: 3,
          }),
          "out_of_order",
        );
        await assert.rejects(pg.query("select * from provider_connections"));
        await pg.query("select record_scheduling_failure($1,'rate_limited')", [
          c,
        ]);
        await assert.rejects(
          importEvent({ ...event, event_id: "while-error", version: 8 }),
        );
        await role(manager);
        const summary = await scalar<
          { status: string; last_error_code: string }[]
        >("select my_scheduling_connections() as result");
        assert.equal(summary[0].status, "error");
        assert.equal(summary[0].last_error_code, "rate_limited");
        await assert.rejects(
          pg.query("select validate_scheduling_connection($1)", [c]),
        );
        await role(undefined, true);
        await pg.query("select validate_scheduling_connection($1)", [c]);
        await role(a);
        assert.equal(
          await scalar<number>(
            "select count(*)::int as result from appointments where external_appointment_id='not-yet-created'",
          ),
          0,
        );
      },
    );
    await t.test(
      "disconnect stops imports and preserves history; owner consent cannot be restored by a manager",
      async () => {
        await role(manager);
        await pg.query("select set_scheduling_connection_status($1,'paused')", [
          c,
        ]);
        await role(undefined, true);
        await assert.rejects(
          importEvent({ ...event, event_id: "paused", version: 9 }),
        );
        await role(a);
        await pg.query(
          "select decide_external_pet_mapping($1,'disconnected')",
          [mapping],
        );
        await role(manager);
        await pg.query("select set_scheduling_connection_status($1,'active')", [
          c,
        ]);
        await role(a);
        assert.equal(
          await scalar(
            "select sync_state as result from appointments where id=$1",
            [appointment],
          ),
          "disconnected",
        );
        await role(undefined, true);
        assert.equal(
          await importEvent({ ...event, event_id: "no-consent", version: 10 }),
          "mapping_required",
        );
        await role(manager);
        await pg.query(
          "select set_scheduling_connection_status($1,'revoked')",
          [c],
        );
        await role(undefined, true);
        await assert.rejects(
          importEvent({ ...event, event_id: "revoked", version: 11 }),
        );
        await assert.rejects(
          pg.query("select validate_scheduling_connection($1)", [c]),
        );
        await role(a);
        assert.equal(
          await scalar<number>(
            "select count(*)::int as result from appointments where source='external'",
          ),
          2,
        );
        assert.equal(
          await scalar("select title as result from appointments where id=$1", [
            manual,
          ]),
          "Manual",
        );
      },
    );
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await pg.close();
  }
});
