import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type {
  ClaimPage,
  ListingClaimStatus,
  BusinessOrganization,
} from "../lib/provider-claiming/schema";
test("Provider claiming: private business identity, independent review and medical trust separation", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    a = randomUUID(),
    b = randomUUID(),
    vet = randomUUID();
  async function role(id?: string, reviewer = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (reviewer) await pg.exec("set role pawport_claim_reviewer");
    else if (id) await pg.exec("set role authenticated");
  }
  async function value<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  const data = (extra: Record<string, unknown> = {}) => ({
    organization_name: "Claimant-entered Happy Tails",
    requested_organization_id: "",
    claimant_role: "Owner",
    business_email: "owner@example.com",
    claim_note: "PRIVATE CLAIM NOTE",
    ...extra,
  });
  const submit = (
    place = "ChIJ-veterinarian",
    extra: Record<string, unknown> = {},
  ) =>
    value("select submit_service_provider_claim($1,$2) as result", [
      place,
      data(extra),
    ]);
  const review = (
    claim: string,
    decision = "approved",
    note = "PRIVATE REVIEW NOTE",
  ) =>
    value("select review_service_provider_claim($1,$2,$3) as result", [
      claim,
      decision,
      note,
    ]);
  const claims = (limit = 25, cursor: ClaimPage["nextCursor"] = null) =>
    value<ClaimPage>("select my_service_provider_claims($1,$2,$3) as result", [
      cursor?.at || null,
      cursor?.id || null,
      limit,
    ]);
  const status = (places = ["ChIJ-veterinarian"]) =>
    value<ListingClaimStatus[]>(
      "select service_provider_claim_statuses($1) as result",
      [places],
    );
  let claimA: string,
    claimB: string,
    org: string,
    location: string,
    petB: string,
    verification: string;
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
      "009_pet_timeline",
      "010_pawport_today",
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    await pg.query("insert into auth.users(id) values($1),($2),($3)", [
      a,
      b,
      vet,
    ]);
    await role(b);
    const hh = await value(
      "insert into households(name) values('Private household') returning id as result",
    );
    petB = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Private pet','Dog','Mixed','Female') returning id as result",
      [hh],
    );
    const vaccine = await value(
      "insert into vaccinations(pet_id,name,clinic,administered_on) values($1,'Rabies','Clinic',current_date) returning id as result",
      [petB],
    );
    await role();
    const clinic = await value(
      "insert into veterinary_providers(name) values('Existing veterinary verifier') returning id as result",
    );
    await pg.query(
      "insert into provider_memberships(provider_id,user_id) values($1,$2)",
      [clinic, vet],
    );
    verification = await value(
      "insert into verification_requests(vaccination_id,provider_id,requested_by) values($1,$2,$3) returning id as result",
      [vaccine, clinic, b],
    );
    await pg.query(
      "insert into health_documents(pet_id,uploaded_by,original_name,object_path,mime_type,byte_size,uploaded_at) values($1,$2,'Private record','PRIVATE PATH','application/pdf',1,now())",
      [petB, b],
    );
    await pg.query(
      "insert into provider_connections(provider_id,google_place_id,connection_type,external_system,status) values($1,'ChIJ-veterinarian','veterinary','mock','pending')",
      [clinic],
    );
    const policies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    const trusted = async () =>
      (
        await pg.query(
          "select (select count(*) from veterinary_providers) vets,(select count(*) from provider_memberships) memberships,(select count(*) from provider_connections) connections,(select count(*) from provider_scheduling_permissions) scheduling_permissions,(select jsonb_agg(jsonb_build_object('status',status,'availability',availability_supported) order by id) from provider_connections) connection_state",
        )
      ).rows;
    const baseline = await trusted();
    // Reproduce Supabase-style default grants and prove they do not expose the reviewer.
    await pg.exec(
      "create role service_role; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on functions to service_role;",
    );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110011_provider_claiming.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await pg.query(
          "select * from pg_policies order by schemaname,tablename,policyname",
        )
      ).rows,
      policies,
    );
    await t.test(
      "all new tables are RLS protected and have no browser or reviewer direct access",
      async () => {
        const tables = [
          "service_provider_organizations",
          "service_provider_locations",
          "service_provider_memberships",
          "service_provider_claims",
        ];
        for (const table of tables)
          assert.equal(
            await value<boolean>(
              "select relrowsecurity as result from pg_class where oid=$1::regclass",
              [table],
            ),
            true,
          );
        for (const who of [a, b, vet, null, "reviewer"]) {
          await role(
            who && who !== "reviewer" ? who : undefined,
            who === "reviewer",
          );
          if (who === null) await pg.exec("set role anon");
          for (const table of tables) {
            await assert.rejects(pg.exec(`select * from ${table}`));
            await assert.rejects(
              pg.exec(`insert into ${table} default values`),
            );
            await assert.rejects(pg.exec(`delete from ${table}`));
          }
          if (who !== "reviewer") {
            await assert.rejects(review(randomUUID()), /permission denied/);
            await assert.rejects(
              pg.exec("select service_provider_claim_review_queue()"),
            );
          }
        }
        await role();
        await pg.exec("set role service_role");
        await assert.rejects(review(randomUUID()), /permission denied/);
        await assert.rejects(
          pg.exec("select service_provider_claim_review_queue()"),
        );
        await assert.rejects(pg.exec("select * from service_provider_claims"));
        await role();
        await pg.exec("set role anon");
        await assert.rejects(claims());
        await assert.rejects(submit());
        await assert.rejects(
          pg.exec("select my_service_provider_organizations()"),
        );
        assert.equal((await status())[0].claimed, false);
      },
    );
    await t.test(
      "submission bounds, immutable request identity, duplicate pending and cross-user claim privacy",
      async () => {
        await role(a);
        claimA = await submit();
        assert.equal((await claims()).claims[0].status, "pending");
        await assert.rejects(submit());
        await assert.rejects(submit("../private"));
        await assert.rejects(submit("x".repeat(256)));
        for (const fields of [
          { requested_by: b },
          { status: "approved" },
          { reviewer_note: "Spoof" },
          { organization_name: "" },
          { organization_name: "a".repeat(161) },
          { claimant_role: "a".repeat(101) },
          { business_email: "invalid" },
          { business_email: "x@-invalid.com" },
          { business_email: "x..y@example.com" },
          { business_email: "<script>@example.com" },
          { business_email: "x".repeat(255) + "@example.com" },
          { claim_note: "a".repeat(1501) },
          { requested_organization_id: randomUUID() },
        ])
          await assert.rejects(submit("OtherPlace", fields));
        await role(b);
        assert.equal((await claims()).claims.length, 0);
        await assert.rejects(
          pg.query("select withdraw_service_provider_claim($1)", [claimA]),
        );
        claimB = await submit();
        await role();
        for (const update of [
          "requested_by=gen_random_uuid()",
          "google_place_id='Moved'",
          "organization_name='Changed'",
        ]) {
          await assert.rejects(
            pg.query(
              `update service_provider_claims set ${update} where id=$1`,
              [claimA],
            ),
          );
        }
        await role(a);
        await assert.rejects(
          pg.query(
            "update service_provider_claims set status='approved' where id=$1",
            [claimA],
          ),
        );
      },
    );
    await t.test(
      "independent reviewer approval is atomic and idempotent; competing claim cannot create another location",
      async () => {
        await role(a, true);
        await assert.rejects(review(claimA));
        await role(undefined, true);
        const queue = await value<
          { businessEmail: string; reviewerNote: string | null }[]
        >("select service_provider_claim_review_queue() as result");
        assert.equal(queue.length, 2);
        assert.equal(queue[0].businessEmail, "owner@example.com");
        const raced = await Promise.allSettled([
          review(claimA),
          review(claimB),
        ]);
        assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(raced[0].status, "fulfilled");
        location = (raced[0] as PromiseFulfilledResult<string>).value;
        assert.equal(await review(claimA), location);
        await assert.rejects(review(claimB));
        await assert.rejects(review(claimA, "rejected"));
        await role();
        assert.equal(
          await value<number>(
            "select count(*)::integer as result from service_provider_locations",
          ),
          1,
        );
        assert.equal(
          await value<number>(
            "select count(*)::integer as result from service_provider_organizations",
          ),
          1,
        );
        org = await value(
          "select organization_id as result from service_provider_locations where id=$1",
          [location],
        );
        assert.equal(
          await value(
            "select role as result from service_provider_memberships where organization_id=$1 and user_id=$2",
            [org, a],
          ),
          "owner",
        );
        assert.equal(
          await value(
            "select status as result from service_provider_claims where id=$1",
            [claimB],
          ),
          "pending",
        );
        await assert.rejects(
          pg.query(
            "update service_provider_locations set organization_id=gen_random_uuid() where id=$1",
            [location],
          ),
        );
        await assert.rejects(
          pg.query(
            "update service_provider_locations set google_place_id='Moved' where id=$1",
            [location],
          ),
        );
        await assert.rejects(
          pg.query(
            "update service_provider_memberships set user_id=$1 where organization_id=$2",
            [b, org],
          ),
        );
        await role(b);
        await assert.rejects(submit());
        await role(a);
        await assert.rejects(
          pg.query("select withdraw_service_provider_claim($1)", [claimA]),
        );
      },
    );
    await t.test(
      "claimed DTO is public but contains no claimant identity or private processing information",
      async () => {
        await role();
        await pg.exec("set role anon");
        const publicStatus = await status();
        assert.equal(publicStatus[0].claimed, true);
        assert.equal(
          publicStatus[0].organizationName,
          "Claimant-entered Happy Tails",
        );
        assert.equal(publicStatus[0].claimable, false);
        for (const forbidden of [
          a,
          b,
          "owner@example.com",
          "PRIVATE CLAIM NOTE",
          "PRIVATE REVIEW NOTE",
          "claimantRole",
          "requestedBy",
          "businessEmail",
          "reviewerNote",
        ]) {
          assert.ok(
            !JSON.stringify(publicStatus).includes(forbidden),
            forbidden,
          );
        }
        await role(a);
        const own = await claims();
        assert.equal(own.claims[0].participationActive, true);
        for (const forbidden of [
          a,
          "owner@example.com",
          "PRIVATE REVIEW NOTE",
          "PRIVATE CLAIM NOTE",
        ]) {
          assert.ok(!JSON.stringify(own).includes(forbidden));
        }
        await assert.rejects(status(Array(21).fill("valid")));
        await assert.rejects(status(["bad/path"]));
        await assert.rejects(
          pg.exec(
            "select service_provider_claim_statuses(array[null]::text[])",
          ),
        );
        assert.equal(
          (await status(["ChIJ-veterinarian", "ChIJ-veterinarian"])).length,
          1,
        );
      },
    );
    await t.test(
      "claiming a veterinarian grants no veterinary membership, medical data, scheduling or review privileges",
      async () => {
        await role();
        assert.deepEqual(await trusted(), baseline);
        await role(a);
        assert.equal(
          (await pg.query("select * from provider_memberships")).rows.length,
          0,
        );
        assert.equal(
          (await pg.query("select * from health_documents")).rows.length,
          0,
        );
        assert.equal(
          (await pg.query("select * from vaccinations where pet_id=$1", [petB]))
            .rows.length,
          0,
        );
        await assert.rejects(
          pg.query("select complete_vaccination_verification($1,'')", [
            verification,
          ]),
        );
        assert.deepEqual(
          await value("select provider_verification_queue() as result"),
          [],
        );
        await assert.rejects(pg.exec("select * from provider_connections"));
        await assert.rejects(
          pg.exec("select * from provider_scheduling_permissions"),
        );
        await assert.rejects(pg.exec("select * from service_reviews"));
        await role(vet);
        assert.equal(
          (
            await value<unknown[]>(
              "select provider_verification_queue() as result",
            )
          ).length,
          1,
        );
        await pg.query(
          "select complete_vaccination_verification($1,'Existing verifier still works')",
          [verification],
        );
        await role(a);
        assert.equal(
          (
            await value<{ notifications: unknown[] }>(
              "select my_notifications() as result",
            )
          ).notifications.length,
          0,
        );
        await role(b);
        assert.equal(
          (
            await value<{ notifications: unknown[] }>(
              "select my_notifications() as result",
            )
          ).notifications.length,
          1,
        );
      },
    );
    await t.test(
      "multi-location owner/admin only, approval rechecks revoked permission, suspended identity cannot be taken over",
      async () => {
        await role(a);
        assert.equal(
          (
            await value<BusinessOrganization[]>(
              "select my_service_provider_organizations() as result",
            )
          )[0].id,
          org,
        );
        const second = await submit("SecondPlace", {
          requested_organization_id: org,
          organization_name: "Ignored browser rename",
        });
        await role(b);
        await assert.rejects(
          submit("ForeignOrgPlace", { requested_organization_id: org }),
        );
        await role();
        await pg.query(
          "update service_provider_memberships set role='staff' where organization_id=$1 and user_id=$2",
          [org, a],
        );
        await role(a);
        assert.deepEqual(
          await value("select my_service_provider_organizations() as result"),
          [],
        );
        await assert.rejects(
          submit("StaffPlace", { requested_organization_id: org }),
        );
        await role(undefined, true);
        await assert.rejects(review(second));
        await role();
        await pg.query(
          "update service_provider_memberships set role='admin' where organization_id=$1 and user_id=$2",
          [org, a],
        );
        await role(undefined, true);
        const secondLocation = await review(second);
        await role();
        assert.equal(
          await value(
            "select organization_id as result from service_provider_locations where id=$1",
            [secondLocation],
          ),
          org,
        );
        assert.equal(
          await value<number>(
            "select count(*)::integer as result from service_provider_organizations",
          ),
          1,
        );
        assert.equal(
          await value(
            "select organization_name as result from service_provider_claims where id=$1",
            [second],
          ),
          "Claimant-entered Happy Tails",
        );
        await pg.query(
          "update service_provider_organizations set status='suspended' where id=$1",
          [org],
        );
        await role(a);
        assert.deepEqual(
          await value("select my_service_provider_organizations() as result"),
          [],
        );
        assert.equal((await status())[0].claimed, false);
        assert.equal((await status())[0].claimable, false);
        assert.equal(
          (await claims()).claims.find((c) => c.id === claimA)
            ?.participationActive,
          false,
        );
        await assert.rejects(
          submit("SuspendedOrg", { requested_organization_id: org }),
        );
        await role(b);
        await assert.rejects(submit());
        await role();
        await pg.query(
          "update service_provider_organizations set status='active' where id=$1",
          [org],
        );
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        assert.equal((await status())[0].claimed, false);
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
      },
    );
    await t.test(
      "withdraw/reject are final, rate counts withdrawn requests, cursor pagination and max limits",
      async () => {
        await role(b);
        await pg.query("select withdraw_service_provider_claim($1)", [claimB]);
        await pg.query("select withdraw_service_provider_claim($1)", [claimB]);
        await role(undefined, true);
        await assert.rejects(review(claimB));
        await role(b);
        const rejected = await submit("RejectedPlace");
        await role(undefined, true);
        await review(rejected, "rejected");
        await review(rejected, "rejected");
        await role(b);
        await assert.rejects(
          pg.query("select withdraw_service_provider_claim($1)", [rejected]),
        );
        for (let n = 0; n < 8; n++) {
          const c = await submit(`RatePlace${n}`);
          await pg.query("select withdraw_service_provider_claim($1)", [c]);
        }
        await assert.rejects(submit("EleventhPlace"), /limit/);
        const all = await claims(50);
        assert.equal(all.claims.length, 10);
        let cursor: ClaimPage["nextCursor"] = null;
        const ids: string[] = [];
        do {
          const p = await claims(3, cursor);
          ids.push(...p.claims.map((c) => c.id));
          cursor = p.nextCursor;
        } while (cursor);
        assert.deepEqual(
          ids,
          all.claims.map((c) => c.id),
        );
        assert.equal(new Set(ids).size, ids.length);
        await assert.rejects(claims(51));
        await assert.rejects(claims(0));
        await assert.rejects(
          pg.exec("select my_service_provider_claims(now(),null,25)"),
        );
        await role();
        await assert.rejects(
          pg.query(
            "update service_provider_claims set status='pending' where id=$1",
            [rejected],
          ),
        );
      },
    );
    await t.test(
      "only Place ID and claimant/PetThread inputs persist; no new medical or scheduling identity",
      async () => {
        await role();
        const cols = (
          await pg.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_name in ('service_provider_organizations','service_provider_locations','service_provider_memberships','service_provider_claims')",
          )
        ).rows.map((r) => r.column_name);
        for (const forbidden of [
          "address",
          "formatted_address",
          "phone",
          "website",
          "rating",
          "reviews",
          "hours",
          "photos",
          "coordinates",
          "veterinary_provider_id",
          "availability_supported",
        ])
          assert.ok(!cols.includes(forbidden));
        assert.deepEqual(await trusted(), baseline);
      },
    );
  } finally {
    await pg.close();
  }
});
