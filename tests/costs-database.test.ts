import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type {
  ExpensePage,
  ExpenseDetail,
  Summary,
  Planned,
  PlannedPage,
} from "../lib/costs/schema";
test("Costs: ownership, explicit allocations, planning and private documents", async (t) => {
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
    const year = new Date().getUTCFullYear(),
      day = `${year}-08-18`;
    const expenseData = {
      title: "Recorded visit",
      category: "veterinary",
      service_date: day,
      amount_cents: 100000,
    };
    const save = (
      data: object = expenseData,
      id: string | null = null,
      p = pet,
    ) =>
      value("select save_pet_expense($1,$2,$3) v", [
        p,
        id,
        JSON.stringify(data),
      ]);
    const e = await save();
    const detail = (id = e) =>
      value<ExpenseDetail>("select my_pet_expense($1,$2) v", [pet, id]);
    const summary = () =>
      value<Summary>("select my_pet_cost_summary($1,$2) v", [pet, year]);
    const plan = await value("select save_pet_coverage_plan($1,null,$2) v", [
      pet,
      JSON.stringify({
        coverage_kind: "accident_illness",
        carrier_name: "Insurance",
        policy_number: "PRIVATEPOLICY",
        status: "active",
      }),
    ]);
    const claim = await value("select save_insurance_claim($1,$2,null,$3) v", [
      pet,
      plan,
      JSON.stringify({
        title: "Claim",
        claim_number: "PRIVATECLAIM",
        amount_reimbursed_cents: 80000,
        amount_approved_cents: 999999,
        owner_out_of_pocket_cents: 1,
      }),
    ]);
    const allocate = (amount: number | null, expense = e, c = claim) =>
      value("select set_expense_claim_allocation($1,$2,$3,$4) v", [
        pet,
        expense,
        c,
        amount,
      ]);
    const plannedData = {
      title: "Owner plan",
      category: "dental",
      planning_year: year,
    };
    const planned = (data: object = plannedData, id: string | null = null) =>
      value("select save_pet_planned_cost($1,$2,$3) v", [
        pet,
        id,
        JSON.stringify(data),
      ]);
    await t.test("Private ownership and direct access boundaries", async () => {
      for (const id of [foreign, business]) {
        await role(id);
        await assert.rejects(detail());
        await assert.rejects(save());
        await assert.rejects(summary());
        await assert.rejects(planned());
        assert.deepEqual(
          await value("select my_cost_care_summary($1) v", [year]),
          [],
        );
      }
      await role(undefined, "anon");
      await assert.rejects(detail());
      await role(owner);
      for (const table of [
        "pet_expenses",
        "expense_claim_allocations",
        "pet_expense_events",
        "pet_planned_costs",
        "pet_cost_budgets",
        "expense_documents",
      ]) {
        await assert.rejects(pg.query("select * from " + table));
        await assert.rejects(pg.query("delete from " + table));
      }
      await assert.rejects(
        pg.query(
          "insert into pet_expense_events(expense_id,actor_id,event_type) values($1,$2,'expense_updated')",
          [e, owner],
        ),
      );
    });
    await t.test(
      "Expense validation, immutable identity and organizational links",
      async () => {
        assert.equal((await detail()).expense.netRecordedCostCents, "100000");
        for (const patch of [
          { amount_cents: -1 },
          { amount_cents: 1.5 },
          { amount_cents: 9000000000001 },
          { currency: "EUR" },
          { source: "provider_verified" },
          { pet_id: pet },
          { category: "diagnosed" },
          { title: "" },
          { notes: "x".repeat(1001) },
          { appointment_id: randomUUID() },
          { coverage_plan_id: randomUUID() },
        ])
          await assert.rejects(save({ ...expenseData, ...patch }, e));
        await role();
        await assert.rejects(
          pg.query("update pet_expenses set pet_id=$1 where id=$2", [
            randomUUID(),
            e,
          ]),
        );
        await assert.rejects(
          pg.query("update pet_expenses set household_id=$1 where id=$2", [
            randomUUID(),
            e,
          ]),
        );
        await assert.rejects(
          pg.query("update pet_expenses set currency='EUR' where id=$1", [e]),
        );
        await role(owner);
        await save(
          { ...expenseData, title: "Corrected", coverage_plan_id: plan },
          e,
        );
        assert.equal((await detail()).expense.title, "Corrected");
        assert.ok(
          (await detail()).events.some((v) => v.type === "expense_updated"),
        );
      },
    );
    await t.test(
      "Owned appointment/routine links are explicit and unrelated-pet links fail",
      async () => {
        await role();
        const otherPet = await value(
          "insert into pets(household_id,name,species,breed,sex) values($1,'Other','Dog','Mixed','Male') returning id v",
          [hh],
        );
        const a = await value(
          "insert into appointments(household_id,pet_id,created_by,appointment_type,title,starts_at,time_zone) values($1,$2,$3,'veterinary','Appointment',now()+interval '1 day','UTC') returning id v",
          [hh, pet, owner],
        );
        const otherA = await value(
          "insert into appointments(household_id,pet_id,created_by,appointment_type,title,starts_at,time_zone) values($1,$2,$3,'veterinary','Other appointment',now()+interval '1 day','UTC') returning id v",
          [hh, otherPet, owner],
        );
        const care = await value(
          "insert into care_plans(household_id,pet_id,created_by,title,category,recurrence_type,time_zone,anchor_local_date) values($1,$2,$3,'Owner routine','wellness','one_time','UTC',current_date) returning id v",
          [hh, pet, owner],
        );
        const otherCare = await value(
          "insert into care_plans(household_id,pet_id,created_by,title,category,recurrence_type,time_zone,anchor_local_date) values($1,$2,$3,'Other routine','wellness','one_time','UTC',current_date) returning id v",
          [hh, otherPet, owner],
        );
        assert.equal(
          await value<number>("select count(*)::int v from pet_expenses"),
          1,
        );
        assert.equal(
          await value<number>("select count(*)::int v from pet_planned_costs"),
          0,
        );
        await assert.rejects(
          pg.query(
            "update pet_expense_events set event_type='expense_updated' where expense_id=$1",
            [e],
          ),
        );
        await role(owner);
        await save(
          { ...expenseData, coverage_plan_id: plan, appointment_id: a },
          e,
        );
        assert.equal((await detail()).expense.appointmentId, a);
        await assert.rejects(
          save({ ...expenseData, appointment_id: otherA }, e),
        );
        const p = await planned({
          ...plannedData,
          appointment_id: a,
          care_plan_id: care,
          status: "cancelled",
        });
        assert.ok(p);
        await assert.rejects(
          planned({ ...plannedData, care_plan_id: otherCare }),
        );
        await assert.rejects(
          planned({ ...plannedData, appointment_id: otherA }),
        );
      },
    );
    await t.test(
      "Explicit allocations use reimbursement only, enforce both caps and preserve claim amounts",
      async () => {
        await allocate(60000);
        assert.equal((await detail()).expense.netRecordedCostCents, "40000");
        assert.equal((await summary()).allocatedReimbursements, "60000");
        await assert.rejects(allocate(100001));
        await assert.rejects(allocate(80001));
        await assert.rejects(allocate(-1));
        await assert.rejects(
          save(
            { ...expenseData, coverage_plan_id: plan, amount_cents: 59999 },
            e,
          ),
        );
        await assert.rejects(save(expenseData, e));
        await assert.rejects(
          value("select save_insurance_claim($1,$2,$3,$4) v", [
            pet,
            plan,
            claim,
            JSON.stringify({ title: "Claim", amount_reimbursed_cents: 59999 }),
          ]),
        );
        const second = await save({ ...expenseData, coverage_plan_id: plan });
        const outcomes = await Promise.allSettled([
          allocate(20000, second),
          allocate(30000, second),
        ]);
        assert.equal(
          outcomes.filter((x) => x.status === "fulfilled").length,
          1,
        );
        assert.equal((await summary()).allocatedReimbursements, "80000");
        const nullClaim = await value(
          "select save_insurance_claim($1,$2,null,$3) v",
          [pet, plan, JSON.stringify({ title: "No reimbursement" })],
        );
        await assert.rejects(allocate(1, e, nullClaim));
        const anotherPlan = await value(
          "select save_pet_coverage_plan($1,null,$2) v",
          [
            pet,
            JSON.stringify({
              coverage_kind: "insurance_other",
              carrier_name: "Other",
              status: "unknown",
            }),
          ],
        );
        const c2 = await value("select save_insurance_claim($1,$2,null,$3) v", [
          pet,
          anotherPlan,
          JSON.stringify({
            title: "Other claim",
            amount_reimbursed_cents: 99999,
          }),
        ]);
        await assert.rejects(allocate(1, e, c2));
        await allocate(null, second);
        await allocate(null);
        assert.equal((await detail()).expense.netRecordedCostCents, "100000");
        await allocate(60000);
        const c = await value<{
          claim: {
            amount_reimbursed_cents: number;
            owner_out_of_pocket_cents: number;
          };
        }>("select my_insurance_claim($1,$2,$3) v", [pet, plan, claim]);
        assert.equal(c.claim.amount_reimbursed_cents, 80000);
        assert.equal(c.claim.owner_out_of_pocket_cents, 1);
        assert.doesNotMatch(
          JSON.stringify(await detail()),
          /PRIVATECLAIM|PRIVATEPOLICY|claim_number|policy_number|household_id|created_by/,
        );
      },
    );
    await t.test(
      "Planning, unknown amount, year checks and one-time confirmed conversion",
      async () => {
        const p = await planned();
        let d = await value<Planned>("select my_pet_planned_cost($1,$2) v", [
          pet,
          p,
        ]);
        assert.equal(d.plannedAmountCents, null);
        assert.equal(d.dueOn, null);
        for (const patch of [
          { planning_year: null },
          { planning_year: 1999 },
          { due_on: `${year + 1}-01-01` },
          { planned_amount_cents: -1 },
          { care_plan_id: randomUUID() },
          { appointment_id: randomUUID() },
          { source: "provider_quote" },
          { status: "converted_to_expense" },
        ])
          await assert.rejects(planned({ ...plannedData, ...patch }));
        await planned(
          { ...plannedData, planned_amount_cents: 70000, status: "completed" },
          p,
        );
        await planned({ ...plannedData, status: "cancelled" }, p);
        await planned({ ...plannedData, planned_amount_cents: 70000 }, p);
        await assert.rejects(
          value("select convert_planned_cost_to_expense($1,$2,null,$3) v", [
            pet,
            p,
            day,
          ]),
        );
        const result = await Promise.all([
          value("select convert_planned_cost_to_expense($1,$2,18000,$3) v", [
            pet,
            p,
            day,
          ]),
          value("select convert_planned_cost_to_expense($1,$2,18000,$3) v", [
            pet,
            p,
            day,
          ]),
        ]);
        assert.equal(result[0], result[1]);
        assert.equal((await detail(result[0])).expense.amountCents, "18000");
        d = await value<Planned>("select my_pet_planned_cost($1,$2) v", [
          pet,
          p,
        ]);
        assert.equal(d.convertedExpenseId, result[0]);
        await assert.rejects(planned(plannedData, p));
        const p2 = await planned({
          ...plannedData,
          planned_amount_cents: 65000,
        });
        assert.ok(p2);
        assert.equal((await summary()).plannedUpcoming, "65000");
      },
    );
    await t.test(
      "Budgets remain independent factual arithmetic and may be negative",
      async () => {
        await value("select save_pet_cost_budget($1,$2,$3,350000) v", [
          pet,
          year,
          "all_care",
        ]);
        await value("select save_pet_cost_budget($1,$2,$3,500000) v", [
          pet,
          year,
          "grooming",
        ]);
        const s = await summary();
        assert.equal(
          BigInt(s.netRecordedCost),
          BigInt(s.grossExpenses) - BigInt(s.allocatedReimbursements),
        );
        assert.equal(
          BigInt(s.unallocatedAfterRecordedAndPlanned!),
          BigInt(s.budgetAmount!) -
            BigInt(s.netRecordedCost) -
            BigInt(s.plannedUpcoming),
        );
        await Promise.all([
          value("select save_pet_cost_budget($1,$2,$3,1) v", [
            pet,
            year,
            "all_care",
          ]),
          value("select save_pet_cost_budget($1,$2,$3,2) v", [
            pet,
            year,
            "all_care",
          ]),
        ]);
        assert.equal(
          (await summary()).categoryBudgets.filter(
            (b) => b.category === "all_care",
          ).length,
          1,
        );
        assert.ok(
          BigInt((await summary()).remainingRecordedBudget!) < BigInt(0),
        );
        await assert.rejects(
          value("select save_pet_cost_budget($1,$2,$3,-1) v", [
            pet,
            year,
            "all_care",
          ]),
        );
      },
    );
    await t.test(
      "Expense cursor pagination has no omissions at equal timestamps, limit and filters",
      async () => {
        await role();
        await pg.query(
          "insert into pet_expenses(household_id,pet_id,created_by,title,category,service_date,amount_cents,created_at) select $1,$2,$3,'Same day','supplies',$4,1,'2026-01-01' from generate_series(1,55)",
          [hh, pet, owner, day],
        );
        await role(owner);
        const first = await value<ExpensePage>(
          "select my_pet_expenses($1,$2,$3,null,null,null,500) v",
          [pet, year, "supplies"],
        );
        assert.equal(first.items.length, 50);
        assert.ok(first.nextCursor);
        const c = first.nextCursor!;
        const next = await value<ExpensePage>(
          "select my_pet_expenses($1,$2,$3,$4,$5,$6) v",
          [pet, year, "supplies", c.date, c.created, c.id],
        );
        assert.equal(next.items.length, 5);
        assert.equal(next.nextCursor, null);
        assert.equal(
          new Set([...first.items, ...next.items].map((e) => e.expenseId)).size,
          55,
        );
        assert.equal(
          (
            await value<ExpensePage>("select my_pet_expenses($1,$2) v", [
              pet,
              year - 1,
            ])
          ).items.length,
          0,
        );
        assert.equal(
          (
            await value<PlannedPage>("select my_pet_planned_costs($1,$2) v", [
              pet,
              year,
            ])
          ).items.length,
          3,
        );
      },
    );
    await t.test(
      "Document prepare, signature-independent DB metadata checks, access and retirement",
      async () => {
        for (const [name, mime, size] of [
          ["receipt.svg", "image/svg+xml", 1],
          ["x.pdf", "application/pdf", 10485761],
          ["../x.pdf", "application/pdf", 10],
        ])
          await assert.rejects(
            value("select prepare_expense_document($1,$2,$3,$4,$5,$6) v", [
              pet,
              e,
              name,
              "receipt",
              mime,
              size,
            ]),
          );
        for (const [extension, mime] of [
          ["pdf", "application/pdf"],
          ["jpg", "image/jpeg"],
          ["png", "image/png"],
        ]) {
          const d = await value<{ id: string; path: string }>(
            "select prepare_expense_document($1,$2,$3,$4,$5,100) v",
            [pet, e, "receipt." + extension, "receipt", mime],
          );
          assert.match(d.path, /^expenses\//);
          await assert.rejects(
            value("select finalize_expense_document($1) v", [d.id]),
          );
          await assert.rejects(
            pg.query(
              "insert into storage.objects(bucket_id,name,metadata) values('expense-documents','arbitrary','{}')",
            ),
          );
          await pg.query(
            "insert into storage.objects(bucket_id,name,metadata) values('expense-documents',$1,$2)",
            [d.path, JSON.stringify({ mimetype: mime, size: 100 })],
          );
          await value("select finalize_expense_document($1) v", [d.id]);
          await value("select finalize_expense_document($1) v", [d.id]);
          assert.doesNotMatch(
            JSON.stringify(await detail()),
            /object_path|expenses\/|uploaded_by/,
          );
          await role(foreign);
          await assert.rejects(
            value("select my_expense_document_delivery($1) v", [d.id]),
          );
          await assert.rejects(
            value("select retire_expense_document($1) v", [d.id]),
          );
          assert.equal(
            await value<boolean>(
              "select can_access_expense_document($1,'read') v",
              [d.path],
            ),
            false,
          );
          await role(undefined, "anon");
          assert.equal(
            await value<boolean>(
              "select can_access_expense_document($1,'read') v",
              [d.path],
            ),
            false,
          );
          await role(owner);
          await value("select retire_expense_document($1) v", [d.id]);
          await assert.rejects(
            value("select my_expense_document_delivery($1) v", [d.id]),
          );
        }
        assert.equal((await detail()).expense.documentCount, 0);
        assert.ok(
          (await detail()).events.some((v) => v.type === "document_removed"),
        );
      },
    );
    await t.test(
      "Share Pass, preventive guidance, health and provider permissions remain separate",
      async () => {
        const pass = await value<{ token: string }>(
          "select create_share_pass($1,24) v",
          [pet],
        );
        await role(undefined, "anon");
        assert.doesNotMatch(
          JSON.stringify(
            await value("select read_share_pass($1) v", [pass.token]),
          ),
          /expenses|budget|reimburse|planned_cost|receipt/,
        );
        await role(owner);
        assert.doesNotMatch(
          JSON.stringify(
            await value(
              "select my_pet_preventive_care($1,'America/New_York') v",
              [pet],
            ),
          ),
          /Recorded visit|Corrected|Owner plan|allocated|grossExpenses/,
        );
        await role();
        assert.equal(
          await value<number>("select count(*)::int v from health_documents"),
          0,
        );
        assert.equal(
          await value<number>("select count(*)::int v from coverage_documents"),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_scheduling_permissions",
          ),
          0,
        );
        const vet = await value(
          "insert into veterinary_providers(name) values('Verifier') returning id v",
        );
        await pg.query(
          "insert into provider_memberships(provider_id,user_id) values($1,$2)",
          [vet, foreign],
        );
        await role(foreign);
        await assert.rejects(detail());
        await assert.rejects(summary());
        await role(owner);
      },
    );
  } finally {
    await pg.close();
  }
});
