import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("Partner activation permissions, grants and durable events", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    owner = randomUUID(),
    foreign = randomUUID(),
    business = randomUUID();
  const value = async <T = string>(sql: string, args: unknown[] = []) =>
    (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  const role = async (user?: string, dbRole?: string) => {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    if (user || dbRole)
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

    for (const id of [owner, foreign, business])
      await pg.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.com",
      ]);
    await value("select bootstrap_partner_operator($1,$2) v", [owner, "admin"]);
    await role(owner);
    const hh = await value(
      "insert into households(name) values('Home') returning id v",
    );
    let partner: string, connection: string, production: string;
    const registry = (contract = "evaluation") =>
      value("select save_partner_registry($1,$2) v", [
        partner || null,
        JSON.stringify({
          partner_key: "test_partner",
          display_name: "Test partner",
          partner_type: "other",
          contract_status: contract,
        }),
      ]);
    const cap = (
      key = "scheduling.appointment.read",
      env = "sandbox",
      status = "approved",
    ) =>
      value("select set_partner_capability($1,$2,$3,$4) v", [
        partner,
        key,
        env,
        status,
      ]);
    const action = (operation: string, id = connection) =>
      value("select partner_activation_action($1,$2) v", [id, operation]);
    const guard = (categories = ["appointment_data"], household = hh) =>
      value<boolean>(
        "select partner_connection_authorized($1,'scheduling.appointment.read',$2,null,null,$3,'scheduling','pawport_to_partner') v",
        [connection, household, categories],
      );
    await t.test(
      "Registry, operator membership and capabilities cannot be self-issued",
      async () => {
        await role(foreign);
        await assert.rejects(registry());
        await assert.rejects(value("select my_partner_operations() v"));
        await assert.rejects(
          pg.query(
            "insert into partner_operator_memberships(user_id,role) values($1,'admin')",
            [foreign],
          ),
        );
        await assert.rejects(
          value("select bootstrap_partner_operator($1,$2) v", [
            foreign,
            "admin",
          ]),
        );
        await role(undefined, "anon");
        await assert.rejects(pg.query("select * from partner_organizations"));
        await assert.rejects(value("select my_partner_operations() v"));
        await role(owner);
        partner = await registry();
        await assert.rejects(cap("pharmacy.order.create"));
        await assert.rejects(cap("scheduling.appointment.read", "production"));
        await cap();
        connection = await value(
          "select create_partner_operational_connection($1,null,null,$2) v",
          [partner, hh],
        );
        production = await value(
          "select create_partner_operational_connection($1,null,null,$2,'production') v",
          [partner, hh],
        );
        await assert.rejects(action("enable"));
        await assert.rejects(action("enable", production));
        await assert.rejects(action("approve_production", production));
        await role(foreign);
        await assert.rejects(cap());
        await assert.rejects(action("enable"));
        await assert.rejects(
          value("select my_partner_connection_consent($1) v", [connection]),
        );
      },
    );
    await t.test(
      "Credentials remain opaque; validation and production locks fail closed",
      async () => {
        await role(owner);
        await assert.rejects(
          value("select register_partner_credential($1,$2) v", [
            connection,
            "NEXT_PUBLIC_SECRET",
          ]),
        );
        await value("select register_partner_credential($1,$2) v", [
          connection,
          "PARTNER_TEST",
        ]);
        await assert.rejects(
          value(
            "select record_partner_validation($1,$2,'PARTNER_TEST',true,true) v",
            [owner, connection],
          ),
        );
        const dto = await value("select my_partner_operations($1,$2) v", [
          partner,
          connection,
        ]);
        assert.doesNotMatch(
          JSON.stringify(dto),
          /PARTNER_TEST|"credential_ref"|"credentialRef"|household_id/,
        );
        await role();
        await value(
          "select record_partner_validation($1,$2,'PARTNER_TEST',true,true) v",
          [owner, connection],
        );
        await role(owner);
        await value("select set_partner_operational_status($1,'sandbox') v", [
          partner,
        ]);
        await assert.rejects(action("enable")); // Global switch still off.
        await role();
        await pg.exec(
          "update partner_runtime_settings set sandbox_enabled=true",
        );
        await role(owner);
        await action("enable");
        await registry("executed");
        await cap("scheduling.appointment.read", "production");
        await assert.rejects(action("enable", production));
        await role();
        assert.equal(
          await value<boolean>(
            "select production_enabled v from partner_runtime_settings",
          ),
          false,
        );
        assert.equal(
          await value<boolean>(
            "select sandbox_enabled v from live_booking_runtime_settings",
          ),
          false,
        );
      },
    );
    await t.test(
      "Explicit owner grants are scoped, revocable, expiring and category bounded",
      async () => {
        await role();
        assert.equal(await guard(), false);
        await role(foreign);
        await assert.rejects(
          value(
            "select set_partner_data_grant($1,'appointment_data','scheduling','pawport_to_partner',true) v",
            [connection],
          ),
        );
        await role(owner);
        await assert.rejects(
          value(
            "select set_partner_data_grant($1,'health_records','scheduling','pawport_to_partner',true) v",
            [connection],
          ),
        );
        for (const category of [
          "pet_identity",
          "owner_contact",
          "appointment_data",
        ])
          await value(
            "select set_partner_data_grant($1,$2,'scheduling','pawport_to_partner',true,now()+interval '1 day') v",
            [connection, category],
          );
        await role();
        assert.equal(await guard(), true);
        assert.equal(await guard([], hh), false);
        assert.equal(await guard(["appointment_data"], randomUUID()), false);
        assert.equal(await guard(["financial"]), false);
        await role(owner);
        await value(
          "select set_partner_data_grant($1,'appointment_data','scheduling','pawport_to_partner',false) v",
          [connection],
        );
        await role();
        assert.equal(await guard(), false);
        await role(owner);
        await value(
          "select set_partner_data_grant($1,'appointment_data','scheduling','pawport_to_partner',true) v",
          [connection],
        );
        await role();
        await pg.query(
          "update partner_data_grants set expires_at=now()-interval '1 second' where connection_id=$1 and data_category='appointment_data' and status='active'",
          [connection],
        );
        assert.equal(await guard(), false);
        await role(owner);
        await value(
          "select set_partner_data_grant($1,'appointment_data','scheduling','pawport_to_partner',true) v",
          [connection],
        );
        await cap("scheduling.appointment.read", "sandbox", "revoked");
        await role();
        assert.equal(await guard(), false);
        await role(owner);
        await cap();
        await value("select set_partner_operational_status($1,'paused') v", [
          partner,
        ]);
        await role();
        assert.equal(await guard(), false);
        await role(owner);
        await value("select set_partner_operational_status($1,'sandbox') v", [
          partner,
        ]);
        await action("pause");
        await role();
        assert.equal(await guard(), false);
        await role(owner);
        await action("enable");
      },
    );
    await t.test(
      "Event idempotency, leases, retries, dead letters and ambiguous mutation quarantine",
      async () => {
        await role(foreign);
        await assert.rejects(value("select claim_partner_events() v"));
        await role(undefined, "pawport_partner_worker");
        const enqueue = (
          type = "catalog_refresh",
          key: string = randomUUID(),
          direction = "outbound",
        ) =>
          value("select enqueue_partner_event($1,$2,$3,$4,$5) v", [
            connection,
            direction,
            type,
            direction === "inbound" ? key : null,
            key,
          ]);
        const event = await enqueue("catalog_refresh", "once");
        assert.equal(await enqueue("catalog_refresh", "once"), event);
        await assert.rejects(enqueue("availability_refresh", "once"));
        const inbound = await enqueue(
          "webhook_received",
          "inbound-once",
          "inbound",
        );
        assert.equal(
          await enqueue("webhook_received", "inbound-once", "inbound"),
          inbound,
        );
        type Lease = { id: string; lease_token: string; attempt_count: number };
        const claim = () => value<Lease[]>("select claim_partner_events(1) v");
        const batches = await Promise.all([claim(), claim()]);
        assert.notEqual(batches[0][0].id, batches[1][0].id);
        for (const b of batches) {
          await value("select complete_partner_event($1,$2,200) v", [
            b[0].id,
            b[0].lease_token,
          ]);
          await assert.rejects(
            value("select complete_partner_event($1,$2,200) v", [
              b[0].id,
              b[0].lease_token,
            ]),
          );
        }
        const mutation = await enqueue("appointment_book");
        const m = (await claim())[0];
        assert.equal(m.id, mutation);
        await value("select fail_partner_event($1,$2,'unknown',true) v", [
          m.id,
          m.lease_token,
        ]);
        assert.deepEqual(await claim(), []);
        const lost = await enqueue("appointment_cancel");
        const lostLease = (await claim())[0];
        await role();
        await pg.query(
          "update partner_integration_events set lease_until=now()-interval '1 second' where id=$1",
          [lost],
        );
        await role(undefined, "pawport_partner_worker");
        assert.deepEqual(await claim(), []);
        await assert.rejects(
          value("select complete_partner_event($1,$2) v", [
            lost,
            lostLease.lease_token,
          ]),
        );
        const retry = await enqueue();
        for (let n = 1; n <= 10; n++) {
          const l = (await claim())[0];
          assert.equal(l.id, retry);
          assert.equal(l.attempt_count, n);
          await value(
            "select fail_partner_event($1,$2,'rate_limited',false,429) v",
            [l.id, l.lease_token],
          );
          await role();
          await pg.query(
            "update partner_integration_events set available_after=now() where id=$1",
            [retry],
          );
          await role(undefined, "pawport_partner_worker");
        }
        assert.deepEqual(await claim(), []);
        await role();
        assert.equal(
          await value(
            "select status v from partner_integration_events where id=$1",
            [retry],
          ),
          "dead_letter",
        );
        assert.equal(
          await value(
            "select status v from partner_integration_events where id=$1",
            [lost],
          ),
          "unknown",
        );
      },
    );
    await t.test(
      "Production prerequisites are independent and approval differs from enablement",
      async () => {
        await role(owner);
        await value(
          "select register_partner_credential($1,'PARTNER_PRODUCTION_TEST') v",
          [production],
        );
        await value("select set_partner_operational_status($1,'active') v", [
          partner,
        ]);
        await action("request_production", production);
        await role();
        await pg.exec(
          "update partner_runtime_settings set production_enabled=true",
        );
        await role(owner);
        await assert.rejects(action("approve_production", production));
        await role();
        await value(
          "select record_partner_validation($1,$2,'PARTNER_PRODUCTION_TEST',true,true) v",
          [owner, production],
        );
        await role(owner);
        await registry("evaluation");
        await assert.rejects(action("approve_production", production));
        await registry("executed");
        await cap("scheduling.appointment.read", "production", "revoked");
        await assert.rejects(action("approve_production", production));
        await cap("scheduling.appointment.read", "production");
        await role();
        await pg.query(
          "update partner_connections set last_validated_at=now()-interval '2 days' where id=$1",
          [production],
        );
        await role(owner);
        await assert.rejects(action("approve_production", production));
        await role();
        await value(
          "select record_partner_validation($1,$2,'PARTNER_PRODUCTION_TEST',true,true) v",
          [owner, production],
        );
        await role(owner);
        await action("approve_production", production);
        await role();
        assert.equal(
          await value<boolean>(
            "select runtime_enabled v from partner_connections where id=$1",
            [production],
          ),
          false,
        );
        await role(owner);
        await action("enable", production);
        await action("disable", production);
        await role();
        await pg.exec(
          "update partner_runtime_settings set production_enabled=false",
        );
        await role(owner);
        await value("select set_partner_operational_status($1,'sandbox') v", [
          partner,
        ]);
      },
    );
    await t.test(
      "Business ownership gives no operator authority and scopes cannot be widened",
      async () => {
        await role();
        const org = await value(
          "insert into service_provider_organizations(name) values('Business fixture') returning id v",
        );
        await pg.query(
          "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner')",
          [org, business],
        );
        await role(business);
        await assert.rejects(value("select my_partner_operations() v"));
        await assert.rejects(cap());
        await assert.rejects(action("enable"));
        await role(owner);
        const businessConnection = await value(
          "select create_partner_operational_connection($1,$2,null,null) v",
          [partner, org],
        );
        await assert.rejects(
          value(
            "select create_partner_operational_connection($1,$2,$3,null) v",
            [partner, org, randomUUID()],
          ),
        );
        await value(
          "select set_partner_data_grant($1,'appointment_data','scheduling','pawport_to_partner',true) v",
          [businessConnection],
        );
        await assert.rejects(
          value("select my_partner_connection_consent($1) v", [
            businessConnection,
          ]),
        );
        await role();
        await assert.rejects(
          pg.query(
            "update partner_connections set household_id=$1,organization_id=null where id=$2",
            [hh, businessConnection],
          ),
        );
        await assert.rejects(
          pg.query(
            "update partner_data_grants set household_id=$1,organization_id=null where connection_id=$2",
            [hh, businessConnection],
          ),
        );
      },
    );
    await t.test(
      "Pilot and audit records remain internal and append-only",
      async () => {
        await role(foreign);
        await assert.rejects(
          value("select save_partner_pilot($1,null,$2) v", [partner, "{}"]),
        );
        await role(owner);
        const pilot = await value("select save_partner_pilot($1,null,$2) v", [
          partner,
          JSON.stringify({
            external_site_reference: "sandbox-site",
            status: "candidate",
          }),
        ]);
        await assert.rejects(
          value("select save_partner_pilot($1,$2,$3) v", [
            partner,
            pilot,
            JSON.stringify({
              external_site_reference: "sandbox-site",
              status: "active",
            }),
          ]),
        );
        await value("select save_partner_pilot($1,$2,$3) v", [
          partner,
          pilot,
          JSON.stringify({
            external_site_reference: "sandbox-site",
            status: "consented",
            consent_received_at: new Date().toISOString(),
          }),
        ]);
        const d = await value<{
          pilotTarget: number;
          pilotCounts: Record<string, number>;
        }>("select my_partner_operations($1) v", [partner]);
        assert.equal(d.pilotTarget, 5);
        assert.equal(d.pilotCounts.consented, 1);
        await role();
        await assert.rejects(
          pg.exec(
            "update partner_operator_audit_events set event_type='pilot_updated'",
          ),
        );
        await assert.rejects(
          pg.exec("delete from partner_connection_activation_events"),
        );
        await assert.rejects(
          pg.query(
            "insert into partner_operator_audit_events(event_type,metadata) values('pilot_updated',$1)",
            [JSON.stringify({ access_token: "forbidden" })],
          ),
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_memberships",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_scheduling_permissions",
          ),
          0,
        );
        assert.equal(
          await value<boolean>(
            "select production_enabled v from partner_runtime_settings",
          ),
          false,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
