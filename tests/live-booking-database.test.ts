import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("Live booking database: permission gates, quotes, canonicalization and durable ambiguity", async (t) => {
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
    const save = () =>
      value("select save_live_booking_binding($1,$2,$3,$4,$5,30,$6,true) v", [
        org,
        location,
        service,
        connection,
        type,
        [resource],
      ]);
    const context = () =>
      value("select prepare_live_availability_context($1,$2,$3,$4) v", [
        owner,
        location,
        service,
        pet,
      ]);
    await t.test(
      "Business role alone cannot configure or enable capabilities",
      async () => {
        await role(business);
        await assert.rejects(save());
        await assert.rejects(
          value("select set_booking_capability($1,true) v", [connection]),
        );
        await assert.rejects(context());
        await assert.rejects(
          pg.query(
            "update provider_connections set booking_supported=true where id=$1",
            [connection],
          ),
        );
        await role();
        await pg.query(
          "insert into provider_scheduling_permissions(connection_id,user_id,role) values($1,$2,'provider_admin')",
          [connection, business],
        );
        await role(business);
        await save();
        await role(staff);
        await assert.rejects(save());
        await role(foreign);
        await assert.rejects(
          value("select my_live_booking_configuration($1,$2) v", [
            org,
            location,
          ]),
        );
      },
    );
    await t.test(
      "Runtime and certification are independent default-off gates",
      async () => {
        await role(undefined, "service_role");
        await assert.rejects(context());
        await role(undefined, "pawport_scheduling_worker");
        await pg.query("select set_live_booking_sandbox_enabled(true)");
        await role(undefined, "service_role");
        await assert.rejects(context());
        await role(undefined, "pawport_scheduling_worker");
        await pg.query("select set_booking_capability($1,true)", [connection]);
        await role(undefined, "service_role");
        assert.ok(await context());
        await pg.query(
          "select record_live_connection_validation($1,'America/New_York')",
          [connection],
        );
      },
    );
    const start = new Date(Date.now() + 48 * 3600000).toISOString(),
      end = new Date(Date.parse(start) + 30 * 60000).toISOString();
    const quote = async (offset = 0) => {
      const slots = [
        {
          startsAt: new Date(
            Date.parse(start) + offset * 3600000,
          ).toISOString(),
          endsAt: new Date(Date.parse(end) + offset * 3600000).toISOString(),
          resourceId: resource,
        },
      ];
      return (
        await value<{ quoteId: string; expiresAt: string; startsAt: string }[]>(
          "select store_live_booking_quotes($1,$2,$3,$4,$5,$6) v",
          [
            owner,
            location,
            service,
            pet,
            "America/New_York",
            JSON.stringify(slots),
          ],
        )
      )[0];
    };
    let q: { quoteId: string; expiresAt: string; startsAt: string };
    await t.test(
      "Safe quotes dedupe, expire within five minutes and reject foreign ownership",
      async () => {
        await role(undefined, "service_role");
        q = await quote();
        assert.equal((await quote()).quoteId, q.quoteId);
        assert.ok(Date.parse(q.expiresAt) - Date.now() <= 300000);
        assert.deepEqual(
          Object.keys(q).sort(),
          ["quoteId", "startsAt", "endsAt", "timeZone", "expiresAt"].sort(),
        );
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [foreign, q.quoteId]),
        );
        await role(owner);
        for (const table of [
          "live_booking_quotes",
          "live_booking_attempts",
          "live_booking_events",
          "service_scheduling_bindings",
        ]) {
          await assert.rejects(pg.query("select * from " + table));
          await assert.rejects(pg.query("delete from " + table));
        }
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [owner, q.quoteId]),
        );
        await role(undefined, "anon");
        await assert.rejects(pg.query("select * from live_booking_quotes"));
      },
    );
    let appointment: string;
    await t.test(
      "One attempt, one canonical external appointment, aliases and existing reminders",
      async () => {
        await role(undefined, "service_role");
        const a = await value<{ attemptId: string; state: string }>(
          "select begin_live_booking($1,$2) v",
          [owner, q.quoteId],
        );
        assert.equal(a.state, "initiated");
        assert.equal(
          (
            await value<{ state: string }>(
              "select begin_live_booking($1,$2) v",
              [owner, q.quoteId],
            )
          ).state,
          "unknown",
        );
        await assert.rejects(
          value("select complete_live_booking($1,$2) v", [a.attemptId, owner]),
        );
        await pg.query("select reconfirm_live_booking($1,$2)", [
          a.attemptId,
          owner,
        ]);
        await pg.query(
          "select record_live_vendor_confirmation($1,$2,'appointment_Success')",
          [a.attemptId, owner],
        );
        assert.equal(
          (
            await value<{ state: string }>(
              "select begin_live_booking($1,$2) v",
              [owner, q.quoteId],
            )
          ).state,
          "finalize",
        );
        appointment = await value("select complete_live_booking($1,$2) v", [
          a.attemptId,
          owner,
        ]);
        assert.equal(
          await value("select complete_live_booking($1,$2) v", [
            a.attemptId,
            owner,
          ]),
          appointment,
        );
        await role();
        const row = (
          await pg.query<Record<string, unknown>>(
            "select * from appointments where id=$1",
            [appointment],
          )
        ).rows[0];
        assert.equal(row.source, "external");
        assert.equal(row.booking_origin, "pawport_live");
        assert.equal(row.created_by, owner);
        assert.equal(row.status, "confirmed");
        assert.equal(row.provider_name, "Provider-entered clinic");
        assert.equal(row.location_text, "Provider-entered address");
        assert.equal(
          await value<number>(
            "select count(*)::int v from appointment_reminders where appointment_id=$1",
            [appointment],
          ),
          2,
        );
        assert.equal(
          await value(
            "select external_version v from external_appointment_state where appointment_id=$1",
            [appointment],
          ),
          null,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from external_appointment_aliases where connection_id=$1",
            [connection],
          ),
          1,
        );
        await role(owner);
        await assert.rejects(
          pg.query("update appointments set status='cancelled' where id=$1", [
            appointment,
          ]),
        );
      },
    );
    await t.test(
      "Later sync advances the same canonical appointment from an unset version",
      async () => {
        await role(undefined, "pawport_scheduling_worker");
        await pg.query("select import_scheduling_event($1,$2)", [
          connection,
          JSON.stringify({
            event_id: "event_sync",
            kind: "upsert",
            external_id: "appointment_Success",
            external_pet_id: "animal_Test",
            version: 0,
            title: "Vendor wellness",
            appointment_type: "veterinary",
            starts_at: start,
            ends_at: end,
            status: "confirmed",
          }),
        ]);
        await role();
        assert.equal(
          await value<number>(
            "select count(*)::int v from appointments where external_connection_id=$1",
            [connection],
          ),
          1,
        );
        assert.equal(
          await value(
            "select id v from appointments where external_appointment_id=$1",
            ["appointment_Success"],
          ),
          appointment,
        );
      },
    );
    await t.test(
      "Unknown outcome is sticky; no local appointment or retry",
      async () => {
        await role(undefined, "service_role");
        const next = await quote(2),
          a = await value<{ attemptId: string }>(
            "select begin_live_booking($1,$2) v",
            [owner, next.quoteId],
          );
        await pg.query("select reconfirm_live_booking($1,$2)", [
          a.attemptId,
          owner,
        ]);
        await pg.query("select fail_live_booking($1,$2,'unknown')", [
          a.attemptId,
          owner,
        ]);
        assert.equal(
          (
            await value<{ state: string }>(
              "select begin_live_booking($1,$2) v",
              [owner, next.quoteId],
            )
          ).state,
          "unknown",
        );
        await assert.rejects(
          value("select complete_live_booking($1,$2) v", [a.attemptId, owner]),
        );
        await role();
        assert.equal(
          await value(
            "select appointment_id v from live_booking_attempts where id=$1",
            [a.attemptId],
          ),
          null,
        );
        await assert.rejects(
          pg.query(
            "update live_booking_events set event_type='booking_completed'",
          ),
        );
      },
    );
    await t.test(
      "Scope, explicit permission revocation and immutable quote identity",
      async () => {
        await role();
        await pg.query(
          "update provider_scheduling_permissions set active=false where connection_id=$1",
          [connection],
        );
        await role(business);
        await assert.rejects(save());
        await role();
        await pg.query(
          "update provider_scheduling_permissions set active=true where connection_id=$1",
          [connection],
        );
        await pg.query(
          "insert into provider_scheduling_permissions(connection_id,user_id,role) values($1,$2,'scheduling_manager')",
          [connection, staff],
        );
        const otherLocation = await value(
          "insert into service_provider_locations(organization_id,google_place_id) values($1,'ChIJ_LiveOther') returning id v",
          [org],
        );
        await pg.exec("begin");
        await pg.query(
          "update service_provider_memberships set role='scheduling_manager',location_scope='selected' where user_id=$1",
          [staff],
        );
        await pg.query(
          "insert into service_provider_membership_locations(membership_id,location_id) select id,$1 from service_provider_memberships where user_id=$2",
          [otherLocation, staff],
        );
        await pg.exec("commit");
        await role(staff);
        await assert.rejects(save());
        await role();
        await pg.query(
          "insert into service_provider_membership_locations(membership_id,location_id) select id,$1 from service_provider_memberships where user_id=$2",
          [location, staff],
        );
        await role(staff);
        await save();
        await role();
        await assert.rejects(
          pg.query("update live_booking_quotes set user_id=$1 where id=$2", [
            foreign,
            q.quoteId,
          ]),
        );
        await assert.rejects(
          pg.query("update live_booking_quotes set pet_id=$1 where id=$2", [
            randomUUID(),
            q.quoteId,
          ]),
        );
        await pg.query(
          "delete from provider_scheduling_permissions where user_id=$1",
          [staff],
        );
      },
    );
    await t.test(
      "Expired quote, changed service binding, missing contact, and replay through a fresh quote fail closed",
      async () => {
        await role(undefined, "service_role");
        const next = await quote(6);
        await role();
        const expired = await value(
          "insert into live_booking_quotes select (jsonb_populate_record(null::live_booking_quotes,to_jsonb(q)||jsonb_build_object('id',gen_random_uuid(),'created_at',now()-interval '10 minutes','expires_at',now()-interval '6 minutes'))).* from live_booking_quotes q where id=$1 returning id v",
          [next.quoteId],
        );
        await role(undefined, "service_role");
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [owner, expired]),
        );
        await role(business);
        await save();
        await role(undefined, "service_role");
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [owner, next.quoteId]),
        );
        const unknownQuote = await quote(2);
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [
            owner,
            unknownQuote.quoteId,
          ]),
          /unknown/,
        );
        await role();
        const otherPet = await value(
          "insert into pets(household_id,name,species,breed,sex) values($1,'Other','Dog','Mixed','Male') returning id v",
          [household],
        );
        await pg.query(
          "insert into external_pet_mappings(connection_id,household_id,pet_id,external_pet_id,match_status,matched_by,matched_at) values($1,$2,$3,'animal_MissingContact','confirmed',$4,now())",
          [connection, household, otherPet, owner],
        );
        await role(undefined, "service_role");
        await assert.rejects(
          value("select prepare_live_availability_context($1,$2,$3,$4) v", [
            owner,
            location,
            service,
            otherPet,
          ]),
          /invalid_mapping/,
        );
      },
    );
    await t.test(
      "Attempt quota and slot batch limits cannot be bypassed",
      async () => {
        await role(undefined, "service_role");
        for (let i = 0; i < 8; i++) {
          const next = await quote(8 + i);
          const attempt = await value<{ attemptId: string }>(
            "select begin_live_booking($1,$2) v",
            [owner, next.quoteId],
          );
          await pg.query("select fail_live_booking($1,$2,'vendor_error')", [
            attempt.attemptId,
            owner,
          ]);
        }
        const extra = await quote(20);
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [owner, extra.quoteId]),
          /rate_limited/,
        );
        await assert.rejects(
          value("select store_live_booking_quotes($1,$2,$3,$4,$5,$6) v", [
            owner,
            location,
            service,
            pet,
            "America/New_York",
            JSON.stringify(
              Array(101).fill({
                startsAt: start,
                endsAt: end,
                resourceId: resource,
              }),
            ),
          ]),
          /Invalid slots/,
        );
      },
    );
    await t.test(
      "Paused connection and revoked mapping invalidate quotes",
      async () => {
        await role(undefined, "service_role");
        const next = await quote(4);
        await role();
        await pg.query(
          "update provider_connections set status='paused' where id=$1",
          [connection],
        );
        await role(undefined, "service_role");
        await assert.rejects(
          value("select begin_live_booking($1,$2) v", [owner, next.quoteId]),
        );
        await role();
        await pg.query(
          "update provider_connections set status='active' where id=$1",
          [connection],
        );
        await pg.query(
          "update external_pet_mappings set match_status='disconnected' where id=$1",
          [mapping],
        );
        await role(undefined, "service_role");
        await assert.rejects(context());
      },
    );
    await t.test(
      "No new veterinary authority, no private integration data in management status",
      async () => {
        await role(business);
        const dto = await value(
          "select my_live_booking_configuration($1,$2) v",
          [org, location],
        );
        const serialized = JSON.stringify(dto);
        for (const secret of [
          "credentialRef",
          "externalPetId",
          "externalOwnerId",
          "household",
          "EZYVET_CONNECTION",
        ])
          assert.ok(!serialized.includes(secret));
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
      },
    );
  } finally {
    await pg.close();
  }
});
