import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Summary } from "../lib/costs/schema";
test("Pet snapshot uses the existing scoped yearly financial read model", async () => {
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
    const organization = await value(
      "insert into service_provider_organizations(name) values('Business') returning id v",
    );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner')",
      [organization, business],
    );
    await role(owner);
    const hh = await value(
      "insert into households(name) values('Home') returning id v",
    );
    const pet = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id v",
      [hh],
    );

    const other = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Ellie','Cat','Mixed','Female') returning id v",
      [hh],
    );
    const expense = (p: string, year: number, amount: number) =>
      value("select save_pet_expense($1,null,$2) v", [
        p,
        JSON.stringify({
          title: "Recorded care",
          category: "veterinary",
          service_date: year + "-06-01",
          amount_cents: amount,
        }),
      ]);
    await expense(pet, 2026, 16500);
    await expense(other, 2026, 999999);
    await expense(pet, 2025, 777777);
    const plan = (year: number, amount: number | null, status = "planned") =>
      value("select save_pet_planned_cost($1,null,$2) v", [
        pet,
        JSON.stringify({
          title: "Owner plan",
          category: "veterinary",
          planning_year: year,
          planned_amount_cents: amount,
          status,
        }),
      ]);
    await plan(2026, 45000);
    await plan(2025, 333333);
    await plan(2026, null);
    await plan(2026, 55555, "cancelled");
    await plan(2026, 55555, "completed");
    const convert = await plan(2026, 123456);
    await value(
      "select convert_planned_cost_to_expense($1,$2,100,'2026-08-01') v",
      [pet, convert],
    );
    await role();
    const location = await value(
      "insert into service_provider_locations(organization_id,google_place_id) values($1,'ChIJ-snapshot') returning id v",
      [organization],
    );
    await pg.query(
      "insert into service_provider_location_profiles(location_id,profile_status) values($1,'published')",
      [location],
    );
    const service = await value(
      "insert into service_provider_services(location_id,name,category,accepts_quote_requests) values($1,'Dental','veterinary',true) returning id v",
      [location],
    );
    await role(owner);
    const request = await value(
      "select submit_service_quote_request($1,$2,$3) v",
      [pet, location, service],
    );
    await role(business);
    await value("select send_service_quote($1,$2,$3) v", [
      organization,
      request,
      JSON.stringify({
        amount_type: "range",
        minimum_amount_cents: 65000,
        maximum_amount_cents: 90000,
      }),
    ]);
    await role(owner);
    await value("select save_quote_to_planning($1,$2,2026,'dental') v", [
      pet,
      request,
    ]);
    const current = await value<Summary>(
      "select my_pet_cost_summary($1,2026) v",
      [pet],
    );
    assert.equal(current.grossExpenses, "16600");
    assert.equal(current.plannedUpcoming, "45000");
    assert.equal(current.openPlannedCount, 3);
    assert.equal(current.budgetAmount, null);
    const previous = await value<Summary>(
      "select my_pet_cost_summary($1,2025) v",
      [pet],
    );
    assert.equal(previous.grossExpenses, "777777");
    assert.equal(previous.plannedUpcoming, "333333");
    await role(foreign);
    await assert.rejects(value("select my_pet_cost_summary($1,2026) v", [pet]));
  } finally {
    await pg.close();
  }
});
