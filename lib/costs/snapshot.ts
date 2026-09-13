import type { Summary } from "./schema";
export type CareCostSnapshot = {
  year: number;
  spent: string;
  gross: string;
  reimbursed: string;
  planned: string;
  expected: string;
  budget: string | null;
  remaining: string | null;
  empty: boolean;
  hasOpenPlans: boolean;
  overBudget: boolean;
  segments: { spent: number; planned: number; remaining: number };
};
// Money stays in integer cents. Only normalized visual proportions use numbers.
export function petCareCostSnapshot(
  summary: Summary,
  petId: string,
  year: number,
): CareCostSnapshot {
  if (summary.petId !== petId || summary.year !== year)
    throw Error("Cost summary scope mismatch");
  const spent = BigInt(summary.netRecordedCost),
    gross = BigInt(summary.grossExpenses),
    reimbursed = BigInt(summary.allocatedReimbursements),
    planned = BigInt(summary.plannedUpcoming);
  const budget =
    summary.budgetAmount === null ? null : BigInt(summary.budgetAmount);
  if (
    [spent, gross, reimbursed, planned].some((n) => n < BigInt(0)) ||
    gross - reimbursed !== spent ||
    (budget !== null && budget < BigInt(0))
  )
    throw Error("Invalid cost summary");
  const expected = spent + planned,
    remaining = budget === null ? null : budget - expected;
  const scale = budget !== null && budget > expected ? budget : expected;
  const proportion = (n: bigint) =>
    scale === BigInt(0) ? 0 : Number((n * BigInt(10000)) / scale) / 100;
  const a = proportion(spent),
    b = proportion(planned);
  return {
    year,
    spent: String(spent),
    gross: String(gross),
    reimbursed: String(reimbursed),
    planned: String(planned),
    expected: String(expected),
    budget: budget === null ? null : String(budget),
    remaining: remaining === null ? null : String(remaining),
    empty:
      gross === BigInt(0) &&
      planned === BigInt(0) &&
      summary.openPlannedCount === 0,
    hasOpenPlans: summary.openPlannedCount > 0,
    overBudget: remaining !== null && remaining < BigInt(0),
    segments: {
      spent: a,
      planned: b,
      remaining:
        budget !== null && remaining !== null && remaining > BigInt(0)
          ? 100 - a - b
          : 0,
    },
  };
}
