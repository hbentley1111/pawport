export { cents } from "@/lib/insurance/schema";
export const categories = [
  "veterinary",
  "emergency",
  "dental",
  "medication",
  "pharmacy",
  "grooming",
  "boarding",
  "daycare",
  "walking",
  "sitting",
  "training",
  "food",
  "supplies",
  "insurance_premium",
  "wellness_plan",
  "other",
] as const;
export const notice =
  "Cost information in PetThread is based on amounts you record. PetThread does not predict provider prices, insurance coverage, or future veterinary costs.";
export function dollars(v: string | number | null | undefined) {
  if (v == null) return "Amount not entered";
  const n = BigInt(v),
    negative = n < BigInt(0),
    a = negative ? -n : n;
  return `${negative ? "-" : ""}$${(a / BigInt(100)).toLocaleString("en-US")}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}
export type Summary = {
  petId: string;
  petName: string;
  year: number;
  grossExpenses: string;
  allocatedReimbursements: string;
  netRecordedCost: string;
  plannedUpcoming: string;
  budgetAmount: string | null;
  remainingRecordedBudget: string | null;
  unallocatedAfterRecordedAndPlanned: string | null;
  openPlannedCount: number;
  categoryExpenses: { category: string; amountCents: string }[];
  categoryBudgets: {
    category: string;
    amountCents: string;
    notes: string | null;
  }[];
};
export type Expense = {
  expenseId: string;
  title: string;
  category: string;
  serviceDate: string;
  createdAt: string;
  providerName: string | null;
  amountCents: string;
  allocatedReimbursementCents: string;
  netRecordedCostCents: string;
  appointmentId: string | null;
  coveragePlanId: string | null;
  documentCount: number;
};
export type Planned = {
  source?: "owner_entered" | "provider_quote";
  quote?: import("@/lib/ecosystem/schema").Quote | null;
  quoteUpdated?: boolean;
  quoteRequestId?: string | null;
  businessName?: string | null;
  plannedCostId: string;
  title: string;
  category: string;
  plannedAmountCents: string | null;
  planningYear: number;
  dueOn: string | null;
  status: string;
  appointmentId: string | null;
  carePlanId: string | null;
  convertedExpenseId: string | null;
  notes: string | null;
};
export type Options = {
  appointments: { id: string; title: string; date: string }[];
  coveragePlans: { id: string; title: string }[];
  carePlans: { id: string; title: string }[];
};
export type Doc = {
  id: string;
  name: string;
  type: string;
  status: string;
  mime: string;
  size: number;
};
export type ExpenseDetail = {
  expense: Expense;
  notes: string | null;
  allocations: {
    claimId: string;
    title: string;
    status: string;
    allocatedCents: string;
  }[];
  eligibleClaims: {
    claimId: string;
    title: string;
    status: string;
    recordedReimbursementCents: string | null;
    unallocatedCents: string | null;
  }[];
  documents: Doc[];
  events: { type: string; date: string }[];
};
export type ExpensePage = {
  items: Expense[];
  nextCursor: { date: string; created: string; id: string } | null;
};
export type PlannedPage = { items: Planned[]; nextCursor: string | null };
