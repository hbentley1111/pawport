import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dollars, cents, type Summary } from "../lib/costs/schema";
import {
  CostSnapshot,
  CostNotice,
  PlannedList,
} from "../components/costs/presentation";
test("Exact cents rendering includes large totals without floating point loss", () => {
  assert.equal(dollars("10800000000000001"), "$108,000,000,000,000.01");
  assert.equal(dollars("-32000"), "-$320.00");
  assert.equal(dollars(null), "Amount not entered");
  assert.equal(cents("842.01"), 84201);
  assert.throws(() => cents("1.001"));
});
test("Snapshot separates expenses, explicit reimbursements, planning and owner budget", () => {
  const s: Summary = {
    petId: "p",
    petName: "Jaxson",
    year: 2026,
    grossExpenses: "100000",
    allocatedReimbursements: "60000",
    netRecordedCost: "40000",
    plannedUpcoming: "65000",
    budgetAmount: "10000",
    remainingRecordedBudget: "-30000",
    unallocatedAfterRecordedAndPlanned: "-95000",
    openPlannedCount: 1,
    categoryExpenses: [],
    categoryBudgets: [],
  };
  const html = renderToStaticMarkup(createElement(CostSnapshot, { data: s }));
  for (const text of [
    "Recorded expenses",
    "Insurance reimbursements allocated",
    "Net recorded cost",
    "Owner-planned costs",
    "Budget you entered",
    "$300.00 over your recorded budget",
    "Unallocated after recorded + planned",
  ])
    assert.ok(html.includes(text));
  assert.doesNotMatch(html, /overspent|available money|recommended|verified/);
});
test("Unscheduled and unknown plans stay owner entered, text is escaped", () => {
  const html = renderToStaticMarkup(
    createElement(PlannedList, {
      base: "/costs",
      items: [
        {
          plannedCostId: "p",
          title: "<script>x</script>",
          category: "dental",
          plannedAmountCents: null,
          planningYear: 2026,
          dueOn: null,
          status: "planned",
          appointmentId: null,
          carePlanId: null,
          convertedExpenseId: null,
          notes: null,
        },
      ],
    }),
  );
  assert.match(html, /Amount not entered/);
  assert.match(html, /Unscheduled/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Owner entered/);
  assert.match(
    renderToStaticMarkup(createElement(CostNotice)),
    /does not predict provider prices/,
  );
});
test("Private proxy signature/body bounds and financial boundaries remain explicit", async () => {
  const upload = await readFile("app/costs/documents/upload/route.ts", "utf8"),
    delivery = await readFile("app/costs/documents/[id]/route.ts", "utf8");
  assert.match(upload, /matchesDocumentSignature/);
  assert.match(upload, /reader.cancel/);
  assert.match(upload, /getUser/);
  assert.match(delivery, /private, no-store/);
  assert.match(delivery, /attachment;/);
  assert.doesNotMatch(delivery, /createSignedUrl|getPublicUrl|service.role/i);
  const sql = await readFile(
    "supabase/migrations/202609110019_cost_care_planning.sql",
    "utf8",
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.(read_share_pass|my_pet_preventive_care|my_pet_timeline)|insert into public\.(insurance_claims|health_documents|coverage_documents|notifications|provider_memberships|provider_scheduling_permissions)/,
  );
});
