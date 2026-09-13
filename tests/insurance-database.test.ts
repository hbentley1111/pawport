import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type {
  PlanDetail,
  PlanSummary,
  ClaimDetail,
  ClaimSummary,
  InsurancePet,
  Renewal,
} from "../lib/insurance/schema";
test("Insurance owner privacy, immutable history and document lifecycle", async (t) => {
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
    const planData = {
      coverage_kind: "accident_illness",
      carrier_name: "Owner-entered carrier",
      policy_number: "SECRET-POLICY-4821",
      member_number: "SECRET-MEMBER-1234",
      status: "active",
      renewal_on: new Date(Date.now() + 10 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
    const savePlan = (
      data: object = planData,
      id: string | null = null,
      p = pet,
    ) =>
      value("select save_pet_coverage_plan($1,$2,$3) v", [
        p,
        id,
        JSON.stringify(data),
      ]);
    const plan = await savePlan();
    const detail = () =>
      value<PlanDetail>("select my_pet_coverage_plan($1,$2) v", [pet, plan]);
    const term = (data: object) =>
      value<number>("select add_pet_coverage_term($1,$2,$3) v", [
        pet,
        plan,
        JSON.stringify(data),
      ]);
    const saveClaim = (data: object, id: string | null = null, p = plan) =>
      value("select save_insurance_claim($1,$2,$3,$4) v", [
        pet,
        p,
        id,
        JSON.stringify(data),
      ]);
    const claim = await saveClaim({
      title: "Dental procedure",
      claim_number: "SECRET-CLAIM-6789",
    });
    const claimDetail = () =>
      value<ClaimDetail>("select my_insurance_claim($1,$2,$3) v", [
        pet,
        plan,
        claim,
      ]);
    await t.test(
      "Owner detail has identifiers; all list/summary DTOs mask them",
      async () => {
        assert.equal(
          (await detail()).plan.policy_number,
          planData.policy_number,
        );
        const list = await value<PlanSummary[]>(
          "select my_pet_coverage_plans($1) v",
          [pet],
        );
        assert.equal(list[0].maskedPolicyNumber, "•••• 4821");
        const claims = await value<ClaimSummary[]>(
          "select my_pet_coverage_claims($1,$2) v",
          [pet, plan],
        );
        assert.equal(claims[0].maskedClaimNumber, "•••• 6789");
        const summary = await value<InsurancePet[]>(
          "select my_insurance_summary() v",
        );
        assert.doesNotMatch(
          JSON.stringify([list, claims, summary]),
          /SECRET|household_id|created_by|object_path/,
        );
        assert.equal(
          (await claimDetail()).claim.claim_number,
          "SECRET-CLAIM-6789",
        );
      },
    );
    await t.test(
      "Anonymous, foreign owner and business owner cannot read or write",
      async () => {
        for (const id of [foreign, business]) {
          await role(id);
          await assert.rejects(detail());
          await assert.rejects(savePlan());
          await assert.rejects(claimDetail());
          await assert.rejects(saveClaim({ title: "Foreign" }, claim));
          assert.deepEqual(await value("select my_insurance_summary() v"), []);
        }
        await role(undefined, "anon");
        await assert.rejects(detail());
        await assert.rejects(value("select my_insurance_summary() v"));
        await role(owner);
        for (const table of [
          "pet_coverage_plans",
          "pet_coverage_terms",
          "coverage_documents",
          "insurance_claims",
          "insurance_claim_events",
          "insurance_claim_documents",
        ]) {
          await assert.rejects(pg.query("select * from " + table));
          await assert.rejects(pg.query("delete from " + table));
        }
        await assert.rejects(value("select ins_plan($1,$2) v", [pet, plan]));
      },
    );
    await t.test(
      "Strict plan validation and immutable identity, reserved trust unavailable",
      async () => {
        for (const patch of [
          { provenance: "carrier_verified" },
          { household_id: hh },
          { created_by: foreign },
          { carrier_name: "" },
          { carrier_name: "x".repeat(161) },
          { policy_number: "x".repeat(129) },
          { notes: "x".repeat(1001) },
          { portal_url: "javascript:alert(1)" },
          { portal_url: "http://example.com" },
          { portal_url: "data:text/plain,test" },
          { started_on: "infinity" },
          { renewal_on: "2500-01-01" },
          { status: "verified" },
        ])
          await assert.rejects(savePlan({ ...planData, ...patch }, plan));
        await role();
        await assert.rejects(
          pg.query("update pet_coverage_plans set pet_id=$1 where id=$2", [
            randomUUID(),
            plan,
          ]),
        );
        await assert.rejects(
          pg.query("update pet_coverage_plans set created_by=$1 where id=$2", [
            foreign,
            plan,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update pet_coverage_plans set provenance='carrier_verified' where id=$1",
            [plan],
          ),
        );
        await role(owner);
        const w = await savePlan({
          ...planData,
          coverage_kind: "wellness_program",
          member_number: "12",
        });
        const list = await value<PlanSummary[]>(
          "select my_pet_coverage_plans($1) v",
          [pet],
        );
        assert.match(
          list.find((p) => p.planId === w)!.coverageLabel,
          /Wellness plan — not insurance/,
        );
        assert.equal(
          list.find((p) => p.planId === w)!.maskedPolicyNumber,
          "••••",
        );
      },
    );
    await t.test(
      "Version allocation preserves terms, validates cents without benefit formulas",
      async () => {
        assert.equal(
          await term({
            deductible_amount_cents: 50000,
            reimbursement_percent: 80,
            annual_limit_unlimited: true,
          }),
          1,
        );
        assert.equal(await term({ deductible_amount_cents: 60000 }), 2);
        const versions = await Promise.all([term({}), term({})]);
        assert.deepEqual(versions.sort(), [3, 4]);
        const terms = (await detail()).terms;
        assert.deepEqual(
          terms.map((t) => t.version),
          [4, 3, 2, 1],
        );
        assert.equal(terms[3].deductible_amount_cents, 50000);
        for (const data of [
          { deductible_amount_cents: -1 },
          { deductible_amount_cents: 1.5 },
          { annual_limit_cents: 100, annual_limit_unlimited: true },
          { reimbursement_percent: 0 },
          { reimbursement_percent: 101 },
          { reimbursement_percent: "NaN" },
          { annual_limit_cents: 9000000000001 },
          { coverage_start_on: "infinity" },
          { waiting_period_notes: "x".repeat(1001) },
          { provenance: "document_attached" },
        ])
          await assert.rejects(term(data));
        await role();
        await assert.rejects(
          pg.query(
            "update pet_coverage_terms set deductible_amount_cents=1 where plan_id=$1",
            [plan],
          ),
        );
        await assert.rejects(
          pg.query("delete from pet_coverage_terms where plan_id=$1", [plan]),
        );
        await role(owner);
      },
    );
    await t.test(
      "All owner-recorded claim statuses append transactional history",
      async () => {
        assert.equal((await claimDetail()).claim.status, "draft");
        for (const status of [
          "submitted",
          "received",
          "in_review",
          "more_information_needed",
          "approved",
          "partially_approved",
          "denied",
          "paid",
          "closed",
        ]) {
          await saveClaim(
            {
              title: "Dental procedure",
              status,
              claim_number: "SECRET-CLAIM-6789",
              amount_submitted_cents: 100,
              amount_approved_cents: 200,
              amount_reimbursed_cents: 300,
            },
            claim,
          );
          const c = await claimDetail();
          assert.equal(c.claim.status, status);
          assert.equal(c.claim.source, "owner_entered");
          assert.ok(
            c.events.some(
              (e) => e.type === "status_changed" && e.newStatus === status,
            ),
          );
          assert.equal(c.claim.owner_out_of_pocket_cents, null);
        }
        assert.ok(
          (await claimDetail()).events.some((e) => e.type === "claim_closed"),
        );
        const count = (await claimDetail()).events.length;
        await saveClaim(
          {
            title: "Dental procedure",
            status: "closed",
            amount_submitted_cents: 100,
            amount_approved_cents: 200,
            amount_reimbursed_cents: 300,
          },
          claim,
        );
        assert.equal((await claimDetail()).events.length, count);
        for (const patch of [
          { source: "carrier_verified" },
          { pet_id: pet },
          { title: "" },
          { claim_number: "x".repeat(129) },
          { owner_note: "x".repeat(1001) },
          { amount_submitted_cents: -1 },
          { status: "guaranteed" },
        ])
          await assert.rejects(saveClaim({ title: "x", ...patch }, claim));
        const other = await savePlan();
        await assert.rejects(saveClaim({ title: "Move" }, claim, other));
        await role();
        await assert.rejects(
          pg.query("update insurance_claims set plan_id=$1 where id=$2", [
            other,
            claim,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update insurance_claim_events set event_type='claim_created' where claim_id=$1",
            [claim],
          ),
        );
        await role(owner);
      },
    );
    let document: { id: string; path: string };
    await t.test(
      "Private prepare/finalize validates actual object, ready evidence only",
      async () => {
        for (const [name, mime, size] of [
          ["x.svg", "image/svg+xml", 10],
          ["x.pdf", "application/pdf", 10485761],
          ["../x.pdf", "application/pdf", 10],
          ["x.pdf", "image/png", 10],
        ])
          await assert.rejects(
            value("select prepare_coverage_document($1,$2,$3,$4,$5,$6) v", [
              pet,
              plan,
              name,
              "policy",
              mime,
              size,
            ]),
          );
        document = await value<{ id: string; path: string }>(
          "select prepare_coverage_document($1,$2,$3,$4,$5,$6) v",
          [pet, plan, "policy.pdf", "policy", "application/pdf", 100],
        );
        assert.equal((await detail()).summary.provenance, "owner_entered");
        await assert.rejects(
          value("select finalize_coverage_document($1) v", [document.id]),
        );
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document($1,'insert') v",
            [document.path],
          ),
          true,
        );
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document('arbitrary','insert') v",
          ),
          false,
        );
        await role(foreign);
        await assert.rejects(
          value("select my_coverage_document_delivery($1) v", [document.id]),
        );
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document($1,'insert') v",
            [document.path],
          ),
          false,
        );
        await role();
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('insurance-documents',$1,$2)",
          [
            document.path,
            JSON.stringify({ mimetype: "application/pdf", size: 99 }),
          ],
        );
        await role(owner);
        await assert.rejects(
          value("select finalize_coverage_document($1) v", [document.id]),
        );
        await role();
        await pg.query("update storage.objects set metadata=$1 where name=$2", [
          JSON.stringify({ mimetype: "application/pdf", size: 100 }),
          document.path,
        ]);
        await role(owner);
        await value("select finalize_coverage_document($1) v", [document.id]);
        await value("select finalize_coverage_document($1) v", [document.id]);
        assert.equal((await detail()).summary.provenance, "document_attached");
        assert.doesNotMatch(
          JSON.stringify(await detail()),
          /object_path|insurance\/|uploaded_by/,
        );
        assert.equal((await detail()).terms[3].deductible_amount_cents, 50000);
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document($1,'read') v",
            [document.path],
          ),
          true,
        );
        await value("select set_insurance_claim_document($1,$2,$3,$4,true) v", [
          pet,
          plan,
          claim,
          document.id,
        ]);
        await value("select set_insurance_claim_document($1,$2,$3,$4,true) v", [
          pet,
          plan,
          claim,
          document.id,
        ]);
        assert.deepEqual((await claimDetail()).documents, [document.id]);
        const another = await savePlan();
        const c2 = await saveClaim({ title: "Other" }, null, another);
        await assert.rejects(
          value("select set_insurance_claim_document($1,$2,$3,$4,true) v", [
            pet,
            another,
            c2,
            document.id,
          ]),
        );
        await value("select retire_coverage_document($1) v", [document.id]);
        assert.equal((await detail()).summary.provenance, "owner_entered");
        assert.equal((await detail()).documents.length, 0);
        assert.deepEqual((await claimDetail()).documents, []);
        await assert.rejects(
          value("select my_coverage_document_delivery($1) v", [document.id]),
        );
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document($1,'read') v",
            [document.path],
          ),
          false,
        );
      },
    );
    await t.test(
      "Storage policies block anonymous, foreign and arbitrary keys without affecting other buckets",
      async () => {
        await role(undefined, "anon");
        assert.equal(
          await value<boolean>(
            "select can_access_coverage_document($1,'read') v",
            [document.path],
          ),
          false,
        );
        assert.deepEqual(
          (
            await pg.query(
              "select name from storage.objects where bucket_id='insurance-documents'",
            )
          ).rows,
          [],
        );
        await role(foreign);
        assert.deepEqual(
          (
            await pg.query(
              "select name from storage.objects where bucket_id='insurance-documents'",
            )
          ).rows,
          [],
        );
        await assert.rejects(
          pg.query(
            "insert into storage.objects(bucket_id,name,metadata) values('insurance-documents','arbitrary','{}')",
          ),
        );
        await role(owner);
        const d = await value<{ id: string; path: string }>(
          "select prepare_coverage_document($1,$2,$3,$4,$5,$6) v",
          [pet, plan, "receipt.jpg", "receipt", "image/jpeg", 100],
        );
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('insurance-documents',$1,$2)",
          [d.path, JSON.stringify({ mimetype: "image/jpeg", size: 100 })],
        );
        await value("select finalize_coverage_document($1) v", [d.id]);
        assert.equal(
          (
            await pg.query("select name from storage.objects where name=$1", [
              d.path,
            ])
          ).rows.length,
          1,
        );
        await pg.query("delete from storage.objects where name=$1", [d.path]);
        assert.equal(
          (
            await pg.query("select name from storage.objects where name=$1", [
              d.path,
            ])
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "Supported insurance document categories do not create health records",
      async () => {
        for (const type of [
          "insurance_card",
          "renewal_notice",
          "claim_form",
          "explanation_of_benefits",
          "invoice",
          "receipt",
          "correspondence",
          "other",
        ]) {
          const d = await value<{ id: string; path: string }>(
            "select prepare_coverage_document($1,$2,$3,$4,$5,$6) v",
            [pet, plan, type + ".png", type, "image/png", 100],
          );
          await role();
          await pg.query(
            "insert into storage.objects(bucket_id,name,metadata) values('insurance-documents',$1,$2)",
            [d.path, JSON.stringify({ mimetype: "image/png", size: 100 })],
          );
          await role(owner);
          await value("select finalize_coverage_document($1) v", [d.id]);
        }
        await role();
        assert.equal(
          await value<number>("select count(*)::int v from health_documents"),
          0,
        );
        assert.equal(
          await value<number>("select count(*)::int v from vaccinations"),
          0,
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
        await role(owner);
      },
    );
    await t.test(
      "Share Pass unchanged; medical and integration roles gain no insurance access",
      async () => {
        const pass = await value<{ token: string }>(
          "select create_share_pass($1,24) v",
          [pet],
        );
        await role(undefined, "anon");
        const shared = await value("select read_share_pass($1) v", [
          pass.token,
        ]);
        assert.doesNotMatch(
          JSON.stringify(shared),
          /insurance|coverage|SECRET|reimburse|carrier|claim_number/,
        );
        await role();
        const vet = await value(
          "insert into veterinary_providers(name) values('Vet') returning id v",
        );
        await pg.query(
          "insert into provider_memberships(provider_id,user_id) values($1,$2)",
          [vet, foreign],
        );
        await role(foreign);
        await assert.rejects(detail());
        await assert.rejects(claimDetail());
        await assert.rejects(
          value("select my_coverage_document_delivery($1) v", [document.id]),
        );
        await role(owner);
      },
    );
    await t.test(
      "Renewals use explicit dates only and never expire status or interpret coverage",
      async () => {
        const rows = await value<Renewal[]>(
          "select my_insurance_renewals('America/New_York') v",
        );
        assert.ok(rows.length <= 3);
        assert.ok(rows.length > 0);
        assert.doesNotMatch(
          JSON.stringify(rows),
          /SECRET|deductible|reimburse|carrier|expired|policy_number/,
        );
        await savePlan({ ...planData, renewal_on: "2000-01-01" }, plan);
        assert.equal((await detail()).summary.status, "active");
        assert.ok(
          !(
            await value<Renewal[]>(
              "select my_insurance_renewals('America/New_York') v",
            )
          ).some((r) => r.id === "coverage-renewal:" + plan),
        );
        await savePlan({ ...planData, renewal_on: null }, plan);
        assert.equal((await detail()).summary.renewalOn, null);
        assert.equal((await detail()).summary.status, "active");
        await assert.rejects(
          value("select my_insurance_renewals('Invalid/Zone') v"),
        );
        const pc = await value(
          "select my_pet_preventive_care($1,'America/New_York') v",
          [pet],
        );
        assert.doesNotMatch(
          JSON.stringify(pc),
          /SECRET|Owner-entered carrier|insurance_claim|deductible/,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
