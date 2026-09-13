import Link from "next/link";
import {
  disclaimer,
  money,
  claimGroup,
  type PlanSummary,
  type ClaimSummary,
  type Term,
} from "@/lib/insurance/schema";
export function InsuranceNotice() {
  return (
    <p className="fine-print routine-card">
      {disclaimer} Wellness programs are tracked separately and are not
      insurance.
    </p>
  );
}
export function MaskedNumber({
  value,
  kind = "Policy",
}: {
  value: string | null;
  kind?: string;
}) {
  return value ? (
    <span
      aria-label={
        value === "••••"
          ? `${kind} number hidden`
          : `${kind} number ending in ${value.slice(-4)}`
      }
    >
      {value}
    </span>
  ) : (
    <span>No {kind.toLowerCase()} number recorded</span>
  );
}
export function CoverageCard({ plan }: { plan: PlanSummary }) {
  return (
    <article className="routine-card">
      <p className="eyebrow">{plan.coverageLabel}</p>
      <h3>{plan.carrierName}</h3>
      {plan.planName && <p>{plan.planName}</p>}
      <p>Status you recorded: {plan.status}</p>
      <p>
        <MaskedNumber
          value={plan.maskedPolicyNumber}
          kind={plan.coverageKind === "wellness_program" ? "Member" : "Policy"}
        />
      </p>
      <p>{plan.provenanceLabel}. Entered terms have not been verified.</p>
      {plan.renewalOn && <p>Recorded renewal date: {plan.renewalOn}</p>}
      <p>{plan.openClaimCount} open claims</p>
      <Link
        href={`/pets/${plan.petId}/insurance/${plan.planId}`}
        className="document-link"
      >
        View{" "}
        {plan.coverageKind === "wellness_program"
          ? "wellness plan"
          : "coverage"}
      </Link>
    </article>
  );
}
export function ClaimList({
  claims,
  base,
}: {
  claims: ClaimSummary[];
  base: string;
}) {
  return (
    <>
      {["Needs action", "In progress", "Completed"].map((group) => (
        <section className="routine-summary" key={group}>
          <h2>{group}</h2>
          {claims
            .filter((c) => claimGroup(c.status) === group)
            .map((c) => (
              <article className="routine-card" key={c.claimId}>
                <h3>
                  <Link href={`${base}/claims/${c.claimId}`}>{c.title}</Link>
                </h3>
                <p>Status you recorded: {c.status.replaceAll("_", " ")}</p>
                <p>
                  <MaskedNumber value={c.maskedClaimNumber} kind="Claim" />
                </p>
                <p>
                  Submitted: {money(c.amountSubmitted)} · Reimbursed:{" "}
                  {money(c.amountReimbursed)}
                </p>
              </article>
            ))}
        </section>
      ))}
      {!claims.length && <p>No claims recorded.</p>}
    </>
  );
}
export function TermHistory({ terms }: { terms: Term[] }) {
  return (
    <section className="routine-summary">
      <h2>Term history</h2>
      {!terms.length && <p>No terms entered.</p>}
      {terms.map((t, i) => (
        <article className="routine-card" key={t.id}>
          <h3>
            {i === 0 ? "Current term" : "Previous term"} · Version {t.version}
          </h3>
          <p>Owner entered · USD</p>
          <p>
            Effective: {t.effective_on || "Not recorded"} — Ends:{" "}
            {t.ends_on || "Not recorded"}
          </p>
          <p>Deductible: {money(t.deductible_amount_cents)}</p>
          <p>
            Reimbursement:{" "}
            {t.reimbursement_percent == null
              ? "Not recorded"
              : `${t.reimbursement_percent}%`}
          </p>
          <p>
            Annual limit:{" "}
            {t.annual_limit_unlimited
              ? "Unlimited (owner entered)"
              : money(t.annual_limit_cents)}
          </p>
          <p>
            Coverage start date you recorded:{" "}
            {t.coverage_start_on || "Not recorded"}
          </p>
          {t.waiting_period_notes && (
            <p>Waiting-period notes: {t.waiting_period_notes}</p>
          )}
          {t.terms_notes && <p>Important notes: {t.terms_notes}</p>}
        </article>
      ))}
    </section>
  );
}
