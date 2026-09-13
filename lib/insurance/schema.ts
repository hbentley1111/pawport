export const coverageKinds = [
  "accident_only",
  "accident_illness",
  "insurance_other",
  "wellness_program",
] as const;
export const claimStatuses = [
  "draft",
  "submitted",
  "received",
  "in_review",
  "more_information_needed",
  "approved",
  "partially_approved",
  "denied",
  "paid",
  "closed",
] as const;
export const documentTypes = [
  "policy",
  "insurance_card",
  "renewal_notice",
  "claim_form",
  "explanation_of_benefits",
  "invoice",
  "receipt",
  "correspondence",
  "other",
] as const;
export const disclaimer =
  "Pawport stores the information you enter. Your insurer and policy documents determine actual coverage, exclusions, reimbursement and claim decisions.";
export function cents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(value))
    throw Error(
      "Enter a nonnegative USD amount with up to two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (n > BigInt(9000000000000)) throw Error("Amount is too large.");
  return Number(n);
}
export function money(value: number | null | undefined) {
  return value == null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value / 100);
}
export function renewalLabel(date: string | null, today: string) {
  if (!date) return "No renewal date recorded";
  return date < today
    ? "Recorded renewal date has passed"
    : date <=
        new Date(Date.parse(today + "T12:00Z") + 30 * 86400000)
          .toISOString()
          .slice(0, 10)
      ? "Renewal coming up"
      : "Recorded renewal date";
}
export function claimGroup(status: string) {
  return ["draft", "more_information_needed"].includes(status)
    ? "Needs action"
    : ["submitted", "received", "in_review"].includes(status)
      ? "In progress"
      : "Completed";
}
export type PlanSummary = {
  planId: string;
  petId: string;
  carrierName: string;
  planName: string | null;
  coverageKind: string;
  coverageLabel: string;
  status: string;
  maskedPolicyNumber: string | null;
  renewalOn: string | null;
  provenance: string;
  provenanceLabel: string;
  openClaimCount: number;
};
export type ClaimSummary = {
  claimId: string;
  title: string;
  status: string;
  source: string;
  serviceDate: string | null;
  submittedOn: string | null;
  maskedClaimNumber: string | null;
  amountSubmitted: number | null;
  amountReimbursed: number | null;
};
export type Document = {
  id: string;
  name: string;
  type: string;
  status: string;
  mime: string;
  size: number;
};
export type Term = {
  id: string;
  version: number;
  effective_on: string | null;
  ends_on: string | null;
  deductible_amount_cents: number | null;
  reimbursement_percent: number | null;
  annual_limit_cents: number | null;
  annual_limit_unlimited: boolean;
  coverage_start_on: string | null;
  waiting_period_notes: string | null;
  terms_notes: string | null;
};
export type Editable = Record<string, string | number | boolean | null>;
export type PlanDetail = {
  summary: PlanSummary;
  plan: Editable;
  terms: Term[];
  documents: Document[];
  claims: ClaimSummary[];
};
export type ClaimDetail = {
  claim: Editable;
  documents: string[];
  events: {
    id: string;
    type: string;
    previousStatus: string | null;
    newStatus: string | null;
    date: string;
  }[];
};
export type InsurancePet = {
  petId: string;
  petName: string;
  activePlanCount: number;
  wellnessPlanCount: number;
  openClaimCount: number;
  nextRenewalOn: string | null;
  plans: PlanSummary[];
};
export type Renewal = {
  id: string;
  petName: string;
  date: string;
  title: string;
  sourceLabel: string;
  actionUrl: string;
};
