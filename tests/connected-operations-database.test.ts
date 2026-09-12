import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("Connected operations: canonical cancellation, privacy, ambiguity and conflict", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const owner = randomUUID(),
    business = randomUUID(),
    foreign = randomUUID(),
    staff = randomUUID(),
    org = randomUUID(),
    location = randomUUID(),
    connection = randomUUID();
  const type = "appointmentType_" + "A".repeat(21),
    resource = "resource_" + "B".repeat(21);
  const value = async <T = string>(sql: string, args: unknown[] = []) =>
    (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  const role = async (user?: string, dbRole?: string) => {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    if (dbRole || user)
      await pg.exec("set role " + (dbRole || "authenticated"));
  };
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    for (const id of [owner, business, foreign, staff])
      await pg.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.com",
      ]);
    await pg.query(
      "insert into service_provider_organizations(id,name) values($1,'Provider-entered clinic')",
      [org],
    );
    await pg.query(
      "insert into service_provider_locations(id,organization_id,google_place_id) values($1,$2,'ChIJ_LiveTest')",
      [location, org],
    );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff')",
      [org, business, staff],
    );
    await pg.query(
      "insert into service_provider_location_profiles(location_id,profile_status,time_zone,address_line1) values($1,'published','America/New_York','Provider-entered address')",
      [location],
    );
    const service = await value(
      "insert into service_provider_services(location_id,category,name) values($1,'veterinary','Annual wellness') returning id v",
      [location],
    );
    await pg.query(
      "insert into provider_connections(id,google_place_id,display_name,connection_type,external_system,status,credential_ref,availability_supported) values($1,'ChIJ_LiveTest','Sandbox','veterinary','ezyvet','active','EZYVET_CONNECTION_TEST',true)",
      [connection],
    );
    await role(owner);
    const household = await value(
      "insert into households(name) values('Household') returning id v",
    );
    const pet = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id v",
      [household],
    );
    await role();
    const mapping = await value(
      "insert into external_pet_mappings(connection_id,household_id,pet_id,external_pet_id,external_owner_id,match_status,matched_by,matched_at) values($1,$2,$3,'animal_Test','contact_Test','confirmed',$4,now()) returning id v",
      [connection, household, pet, owner],
    );
    await pg.query(
      "insert into provider_scheduling_permissions(connection_id,user_id,role) values($1,$2,'provider_admin')",
      [connection, business],
    );
    await role(business);
    await value(
      "select save_live_booking_binding($1,$2,$3,$4,$5,30,$6,true) v",
      [org, location, service, connection, type, [resource]],
    );
    await role(undefined, "pawport_scheduling_worker");
    await pg.query("select set_live_booking_sandbox_enabled(true)");
    await pg.query("select set_booking_capability($1,true)", [connection]);
    let serial = 0;
    // Keep the cancellation-dedupe fixtures on one UTC day regardless of test-run time.
    const fixtureDay =
      Math.floor(Date.now() / 86400000) * 86400000 + 3 * 86400000;
    const createAppointment = async () => {
      await role(undefined, "service_role");
      await pg.query(
        "select record_live_connection_validation($1,'America/New_York')",
        [connection],
      );
      const start = new Date(
          fixtureDay + 12 * 3600000 + serial++ * 60000,
        ).toISOString(),
        end = new Date(Date.parse(start) + 1800000).toISOString();
      const quotes = await value<{ quoteId: string }[]>(
        "select store_live_booking_quotes($1,$2,$3,$4,$5,$6) v",
        [
          owner,
          location,
          service,
          pet,
          "America/New_York",
          JSON.stringify([
            { startsAt: start, endsAt: end, resourceId: resource },
          ]),
        ],
      );
      const attempt = await value<{ attemptId: string }>(
        "select begin_live_booking($1,$2) v",
        [owner, quotes[0].quoteId],
      );
      await pg.query("select reconfirm_live_booking($1,$2)", [
        attempt.attemptId,
        owner,
      ]);
      await pg.query("select record_live_vendor_confirmation($1,$2,$3)", [
        attempt.attemptId,
        owner,
        "appointment_Connected" + serial,
      ]);
      return value("select complete_live_booking($1,$2) v", [
        attempt.attemptId,
        owner,
      ]);
    };
    const appointment = await createAppointment();
    const ctx = (id = appointment, user = owner) =>
      value<{ updatedAt: string; startsAt: string; endsAt: string }>(
        "select prepare_connected_context($1,$2) v",
        [user, id],
      );
    const begin = async (id = appointment, user = owner) => {
      const c = await ctx(id, user);
      return value<{ state: string; mutationId: string }>(
        "select begin_connected_cancellation($1,$2,$3,123,100) v",
        [user, id, c.updatedAt],
      );
    };
    await t.test(
      "Stable links are created automatically and cannot be read or changed by browsers",
      async () => {
        await role();
        assert.equal(
          await value<number>(
            "select count(*)::int v from live_booking_appointment_links where appointment_id=$1",
            [appointment],
          ),
          1,
        );
        await assert.rejects(
          pg.query("delete from live_booking_appointment_links"),
        );
        for (const who of [owner, business, foreign]) {
          await role(who);
          for (const table of [
            "live_booking_appointment_links",
            "live_appointment_mutations",
            "live_appointment_mutation_events",
            "live_reschedule_quotes",
            "availability_recheck_requests",
          ])
            await assert.rejects(pg.query("select * from " + table));
          await assert.rejects(begin());
        }
        await role(undefined, "anon");
        await assert.rejects(
          pg.query("select * from live_appointment_mutations"),
        );
      },
    );
    await t.test(
      "Operator-only capability and unsupported rescheduling fail closed",
      async () => {
        await role(undefined, "service_role");
        await assert.rejects(ctx());
        await role(business);
        await assert.rejects(
          pg.query(
            "select set_appointment_mutation_capabilities($1,true,false)",
            [connection],
          ),
        );
        await role(undefined, "pawport_scheduling_worker");
        await assert.rejects(
          pg.query(
            "select set_appointment_mutation_capabilities($1,true,true)",
            [connection],
          ),
          /unsupported/,
        );
        await pg.query(
          "select set_appointment_mutation_capabilities($1,true,false)",
          [connection],
        );
        await role(undefined, "service_role");
        assert.ok(await ctx());
        await assert.rejects(begin());
        await pg.query("select record_appointment_mutation_validation($1)", [
          connection,
        ]);
      },
    );
    await t.test(
      "Foreign owners and business roles without explicit integration authority cannot mutate",
      async () => {
        await role(undefined, "service_role");
        await assert.rejects(ctx(appointment, foreign));
        await assert.rejects(ctx(appointment, staff));
        await role();
        await pg.query(
          "update provider_scheduling_permissions set active=false where connection_id=$1",
          [connection],
        );
        await role(undefined, "service_role");
        await assert.rejects(ctx(appointment, business));
        await role();
        await pg.query(
          "update provider_scheduling_permissions set active=true where connection_id=$1",
          [connection],
        );
        await role(undefined, "service_role");
        assert.ok(await ctx(appointment, business));
        await role();
        const manual = await value(
          "insert into appointments(household_id,pet_id,created_by,source,title,appointment_type,starts_at,time_zone,status) values($1,$2,$3,'manual','Manual','other',now()+interval '3 days','UTC','scheduled') returning id v",
          [household, pet, owner],
        );
        await role(undefined, "service_role");
        await assert.rejects(ctx(manual));
      },
    );
    await t.test(
      "Sandbox, active business, fresh validation and confirmed mapping remain mandatory",
      async () => {
        await role();
        await pg.query(
          "update live_booking_runtime_settings set sandbox_enabled=false",
        );
        await role(undefined, "service_role");
        await assert.rejects(ctx());
        await role();
        await pg.query(
          "update live_booking_runtime_settings set sandbox_enabled=true",
        );
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        await role(undefined, "service_role");
        await assert.rejects(ctx());
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
        await pg.query(
          "update provider_connections set appointment_mutation_validated_at=now()-interval '6 minutes' where id=$1",
          [connection],
        );
        await role(undefined, "service_role");
        await assert.rejects(begin(), /unavailable/);
        await pg.query("select record_appointment_mutation_validation($1)", [
          connection,
        ]);
        await role();
        await pg.query(
          "update external_pet_mappings set match_status='disconnected' where id=$1",
          [mapping],
        );
        await role(undefined, "service_role");
        await assert.rejects(ctx());
        await role();
        await pg.query(
          "update external_pet_mappings set match_status='confirmed' where id=$1",
          [mapping],
        );
        await role(undefined, "service_role");
        assert.ok(await ctx());
      },
    );
    await t.test(
      "One unresolved mutation, no local cancellation before vendor confirmation, canonical identity retained",
      async () => {
        await role(undefined, "service_role");
        const m = await begin();
        assert.equal(m.state, "initiated");
        assert.equal((await begin()).state, "unknown");
        await role();
        assert.equal(
          await value("select status v from appointments where id=$1", [
            appointment,
          ]),
          "confirmed",
        );
        await role(undefined, "service_role");
        await assert.rejects(
          value("select complete_connected_cancellation($1,$2) v", [
            owner,
            m.mutationId,
          ]),
        );
        await pg.query("select assert_connected_dispatch($1,$2)", [
          owner,
          m.mutationId,
        ]);
        await assert.rejects(
          pg.query("select assert_connected_dispatch($1,$2)", [
            owner,
            m.mutationId,
          ]),
        );
        await pg.query("select record_connected_vendor_confirmation($1,$2)", [
          owner,
          m.mutationId,
        ]);
        assert.equal(
          (
            await value<{ cancelled: boolean }>(
              "select complete_connected_cancellation($1,$2) v",
              [owner, m.mutationId],
            )
          ).cancelled,
          true,
        );
        await value("select complete_connected_cancellation($1,$2) v", [
          owner,
          m.mutationId,
        ]);
        await role();
        assert.equal(
          await value("select status v from appointments where id=$1", [
            appointment,
          ]),
          "cancelled",
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from availability_recheck_requests",
          ),
          1,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from notifications where type='appointment_change'",
          ),
          0,
        );
        await assert.rejects(
          pg.query(
            "update live_appointment_mutation_events set event_type='cancel_completed'",
          ),
        );
      },
    );
    await t.test(
      "Provider cancellation notifies only the household owner and dedupes the recheck window",
      async () => {
        const id = await createAppointment();
        await pg.query("select record_appointment_mutation_validation($1)", [
          connection,
        ]);
        const m = await begin(id, business);
        await pg.query("select assert_connected_dispatch($1,$2)", [
          business,
          m.mutationId,
        ]);
        await pg.query("select record_connected_vendor_confirmation($1,$2)", [
          business,
          m.mutationId,
        ]);
        await value("select complete_connected_cancellation($1,$2) v", [
          business,
          m.mutationId,
        ]);
        await role();
        assert.equal(
          await value(
            "select user_id v from notifications where live_mutation_id=$1",
            [m.mutationId],
          ),
          owner,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from availability_recheck_requests",
          ),
          1,
        );
        await role(owner);
        const n = await value<{ notifications: unknown[] }>(
          "select my_notifications() v",
        );
        assert.ok(JSON.stringify(n).includes("appointment_change"));
        assert.ok(!JSON.stringify(n).includes("live_mutation_id"));
        await role(foreign);
        assert.equal(
          (
            await value<{ notifications: unknown[] }>(
              "select my_notifications() v",
            )
          ).notifications.length,
          0,
        );
      },
    );
    await t.test(
      "Timeout remains unknown and unchanged; inactive vendor reconciliation can conclude it",
      async () => {
        const id = await createAppointment();
        await pg.query("select record_appointment_mutation_validation($1)", [
          connection,
        ]);
        const m = await begin(id);
        await pg.query("select assert_connected_dispatch($1,$2)", [
          owner,
          m.mutationId,
        ]);
        await pg.query("select fail_connected_mutation($1,$2,'unknown')", [
          owner,
          m.mutationId,
        ]);
        assert.equal((await begin(id)).state, "unknown");
        await role();
        assert.equal(
          await value("select status v from appointments where id=$1", [id]),
          "confirmed",
        );
        await pg.query(
          "update live_appointment_mutations set next_check_at=now()-interval '1 minute' where id=$1",
          [m.mutationId],
        );
        await role(undefined, "service_role");
        let jobs = await value<
          { leaseToken: string; expectedUpdatedAt: string }[]
        >("select lease_connected_reconciliation($1,$2,1) v", [owner, id]);
        let r = await value<{ state: string }>(
          "select reconcile_connected_mutation($1,$2,$3,true,100) v",
          [m.mutationId, jobs[0].leaseToken, jobs[0].expectedUpdatedAt],
        );
        assert.equal(r.state, "unknown");
        await role();
        await pg.query(
          "update live_appointment_mutations set next_check_at=now() where id=$1",
          [m.mutationId],
        );
        await role(undefined, "service_role");
        jobs = await value("select lease_connected_reconciliation($1,$2,1) v", [
          owner,
          id,
        ]);
        r = await value(
          "select reconcile_connected_mutation($1,$2,$3,false,101) v",
          [m.mutationId, jobs[0].leaseToken, jobs[0].expectedUpdatedAt],
        );
        assert.equal(r.state, "reconciled");
        await role();
        assert.equal(
          await value("select status v from appointments where id=$1", [id]),
          "cancelled",
        );
      },
    );
    await t.test(
      "A sync precondition change blocks dispatch and preserves the newer appointment",
      async () => {
        const id = await createAppointment();
        await pg.query("select record_appointment_mutation_validation($1)", [
          connection,
        ]);
        const m = await begin(id);
        await role();
        await pg.query(
          "update appointments set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",
          [id],
        );
        await role(undefined, "service_role");
        await assert.rejects(
          pg.query("select assert_connected_dispatch($1,$2)", [
            owner,
            m.mutationId,
          ]),
          /conflict/,
        );
        await pg.query("select fail_connected_mutation($1,$2,'conflict')", [
          owner,
          m.mutationId,
        ]);
        await role();
        assert.equal(
          await value("select status v from appointments where id=$1", [id]),
          "confirmed",
        );
      },
    );
    await t.test(
      "Vendor sync cancellation enqueues a real availability recheck, never a fabricated slot",
      async () => {
        const id = await createAppointment();
        await role();
        await pg.query(
          "update appointments set status='cancelled' where id=$1",
          [id],
        );
        await pg.query(
          "update appointments set status='cancelled' where id=$1",
          [id],
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from availability_matches",
          ),
          0,
        );
        await pg.query(
          "update availability_recheck_requests set available_after=now()",
        );
        await role(undefined, "service_role");
        const jobs = await value<
          {
            id: string;
            token: string;
            cursor: string | null;
            more: boolean;
            watchIds: string[];
          }[]
        >("select lease_live_rechecks(1) v");
        assert.equal(jobs.length, 1);
        assert.deepEqual(jobs[0].watchIds, []);
        await pg.query("select complete_live_recheck($1,$2,$3,$4,true)", [
          jobs[0].id,
          jobs[0].token,
          jobs[0].cursor,
          jobs[0].more,
        ]);
      },
    );
    await t.test(
      "No medical or integration authority is created; provider reads expose only safe appointment fields",
      async () => {
        await role(business);
        const list = await value("select my_connected_appointments($1,$2) v", [
          org,
          location,
        ]);
        for (const key of [
          "household",
          "credential",
          "externalOwner",
          "mappingId",
          "connectionId",
        ])
          assert.ok(!JSON.stringify(list).includes(key));
        await role();
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_memberships",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from veterinary_providers",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_scheduling_permissions",
          ),
          1,
        );
        await assert.rejects(
          pg.query(
            "update provider_connections set reschedule_supported=true where id=$1",
            [connection],
          ),
        );
      },
    );
  } finally {
    await pg.close();
  }
});
