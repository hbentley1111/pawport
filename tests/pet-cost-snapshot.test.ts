import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { petCareCostSnapshot } from "../lib/costs/snapshot";
import type { Summary } from "../lib/costs/schema";
import { PetCareCostSnapshot } from "../components/costs/pet-care-cost-snapshot";
const summary = (
  gross = "16500",
  planned = "45000",
  budget: string | null = "90000",
): Summary => ({
  petId: "pet-a",
  petName: "Jaxson",
  year: 2026,
  grossExpenses: gross,
  allocatedReimbursements: "0",
  netRecordedCost: gross,
  plannedUpcoming: planned,
  budgetAmount: budget,
  remainingRecordedBudget: null,
  unallocatedAfterRecordedAndPlanned: null,
  openPlannedCount: planned === "0" ? 0 : 1,
  categoryExpenses: [],
  categoryBudgets: [],
});
const model = (s: Summary) => petCareCostSnapshot(s, "pet-a", 2026);
const html = (s: Summary) =>
  renderToStaticMarkup(
    createElement(PetCareCostSnapshot, {
      petId: "pet-a",
      year: 2026,
      data: model(s),
    }),
  );
test("Spent, planned, expected and remaining use exact cents", () => {
  const d = model(summary());
  assert.equal(d.spent, "16500");
  assert.equal(d.planned, "45000");
  assert.equal(d.expected, "61500");
  assert.equal(d.remaining, "28500");
  assert.equal(d.overBudget, false);
});
for (const [label, gross, planned] of [
  ["spent only", "16500", "0"],
  ["planned only", "0", "45000"],
  ["no data", "0", "0"],
])
  test(label, () => {
    const d = model(summary(gross, planned, null));
    assert.equal(d.expected, String(BigInt(gross) + BigInt(planned)));
    assert.equal(d.remaining, null);
    assert.equal(d.empty, label === "no data");
    const output = html(summary(gross, planned, null));
    for (const text of ["Spent so far", "Planned", "Expected total"])
      assert.ok(output.includes(text));
  });
test("No budget creates no fictional remaining label", () => {
  const output = html(summary("16500", "45000", null));
  assert.doesNotMatch(output, /Remaining budget|<dt>Budget/);
});
test("Over plan preserves signed remaining and explicit over-budget state", () => {
  const d = model(summary("16500", "45000", "50000"));
  assert.equal(d.remaining, "-11500");
  assert.equal(d.overBudget, true);
  assert.match(
    html(summary("16500", "45000", "50000")),
    /Over recorded budget/,
  );
  assert.match(html(summary("16500", "45000", "50000")), /\$115.00/);
});
test("Explicit reimbursement allocation preserves the existing net budget basis", () => {
  const s = {
    ...summary("100000", "20000", "100000"),
    allocatedReimbursements: "60000",
    netRecordedCost: "40000",
  };
  const d = model(s);
  assert.equal(d.expected, "60000");
  assert.equal(d.remaining, "40000");
  const output = html(s);
  assert.match(output, /Recorded expenses \$1,000.00/);
  assert.match(output, /Reimbursements allocated \$600.00/);
  assert.match(output, /Net recorded cost/);
});
test("Cross-pet/year DTOs and inconsistent financial math are rejected", () => {
  assert.throws(() => model({ ...summary(), petId: "pet-b" }));
  assert.throws(() => model({ ...summary(), year: 2025 }));
  assert.throws(() => model({ ...summary(), netRecordedCost: "-1" }));
});
test("Unknown/range plans do not become an invented amount or empty state", () => {
  const d = model({ ...summary("0", "0", null), openPlannedCount: 1 });
  assert.equal(d.empty, false);
  assert.equal(d.expected, "0");
  assert.match(
    html({ ...summary("0", "0", null), openPlannedCount: 1 }),
    /including quote ranges/,
  );
});
test("Whole card is one link with accessible visual values and no nested controls", () => {
  const output = html(summary());
  assert.match(output, /href="\/pets\/pet-a\/costs\?year=2026"/);
  assert.match(output, /role="img"/);
  assert.match(
    output,
    /Spent so far \$165.00.*Planned \$450.00.*Expected total \$615.00.*Remaining budget \$285.00/,
  );
  assert.equal((output.match(/<a /g) || []).length, 1);
  assert.doesNotMatch(output, /<button|tabindex="-1"/);
});
test("Empty and unavailable are different; zero budget is retained", () => {
  assert.match(html(summary("0", "0", null)), /No care costs recorded yet/);
  assert.match(html(summary("0", "0", "0")), /<dt>Budget/);
  const output = renderToStaticMarkup(
    createElement(PetCareCostSnapshot, { petId: "p", year: 2026, data: null }),
  );
  assert.match(output, /temporarily unavailable/);
  assert.doesNotMatch(output, /No care costs recorded yet|\$0.00/);
});
test("Large financial totals retain integer precision", () => {
  const d = model(summary("10000000000000001", "11", null));
  assert.equal(d.expected, "10000000000000012");
  assert.ok(Number.isFinite(d.segments.spent));
});
