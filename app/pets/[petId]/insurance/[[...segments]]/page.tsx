import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppFrame } from "@/components/app-frame";
import { ownedPet } from "@/lib/pet-data";
import { insuranceRpc } from "@/lib/insurance/data";
import type {
  PlanSummary,
  PlanDetail,
  ClaimDetail,
} from "@/lib/insurance/schema";
import {
  CoverageCard,
  InsuranceNotice,
  TermHistory,
  ClaimList,
} from "@/components/insurance/presentation";
import {
  InsuranceForm,
  DocumentUpload,
  DocumentList,
  RenewalNote,
} from "@/components/insurance/forms";
export const dynamic = "force-dynamic";
async function requestTime() {
  return Date.now();
}
export default async function PetInsurance({
  params,
}: {
  params: Promise<{ petId: string; segments?: string[] }>;
}) {
  const { petId, segments: s = [] } = await params;
  const { db, pet } = await ownedPet(petId);
  const base = `/pets/${pet.id}/insurance`;
  const now = await requestTime();
  let content: React.ReactNode;
  if (!s.length) {
    const plans = await insuranceRpc<PlanSummary[]>(
      db,
      "my_pet_coverage_plans",
      { p_pet: petId },
    );
    content = (
      <>
        <h1>{pet.name}’s coverage</h1>
        {plans.map((p) => (
          <CoverageCard key={p.planId} plan={p} />
        ))}
        {!plans.length && <p>No coverage information added.</p>}
        <Link href={`${base}/new`}>Add insurance or wellness plan</Link>
      </>
    );
  } else if (s.length === 1 && s[0] === "new")
    content = (
      <>
        <h1>Add insurance or wellness plan</h1>
        <InsuranceForm mode="plan" petId={petId} />
      </>
    );
  else {
    if (
      !z.uuid().safeParse(s[0]).success ||
      s.length > 3 ||
      (s.length === 2 && !["edit", "claims"].includes(s[1])) ||
      (s.length === 3 &&
        (s[1] !== "claims" ||
          (s[2] !== "new" && !z.uuid().safeParse(s[2]).success)))
    )
      notFound();
    const planId = s[0];
    const d = await insuranceRpc<PlanDetail>(db, "my_pet_coverage_plan", {
      p_pet: petId,
      p_plan: planId,
    });
    const planBase = `${base}/${planId}`;
    if (s[1] === "edit")
      content = (
        <>
          <h1>Edit coverage information</h1>
          <InsuranceForm
            mode="plan"
            petId={petId}
            planId={planId}
            initial={d.plan}
          />
        </>
      );
    else if (s[1] === "claims" && s[2] === "new")
      content = (
        <>
          <h1>Record a claim</h1>
          <InsuranceForm mode="claim" petId={petId} planId={planId} />
        </>
      );
    else if (s[1] === "claims" && s[2]) {
      const c = await insuranceRpc<ClaimDetail>(db, "my_insurance_claim", {
        p_pet: petId,
        p_plan: planId,
        p_claim: s[2],
      });
      content = (
        <>
          <h1>{String(c.claim.title)}</h1>
          <p>
            Status you recorded: {String(c.claim.status).replaceAll("_", " ")}
          </p>
          <p>
            Owner entered. PetThread has not verified or submitted this claim.
          </p>
          <InsuranceForm
            mode="claim"
            petId={petId}
            planId={planId}
            claimId={s[2]}
            initial={c.claim}
          />
          <DocumentList
            documents={d.documents}
            petId={petId}
            planId={planId}
            claimId={s[2]}
            linked={c.documents}
          />
          <DocumentUpload petId={petId} planId={planId} />
          <h2>Recorded history</h2>
          {c.events.map((e) => (
            <p key={e.id}>
              {e.date.slice(0, 10)} · {e.type.replaceAll("_", " ")}{" "}
              {e.newStatus?.replaceAll("_", " ")}
            </p>
          ))}
        </>
      );
    } else if (s[1] === "claims")
      content = (
        <>
          <h1>Claims</h1>
          <ClaimList claims={d.claims} base={planBase} />
          <Link href={`${planBase}/claims/new`}>Record a claim</Link>
        </>
      );
    else
      content = (
        <>
          <h1>{d.summary.carrierName}</h1>
          <CoverageCard plan={d.summary} />
          <RenewalNote date={d.summary.renewalOn} now={now} />
          <Link href={`${planBase}/edit`}>Edit information</Link>
          <details className="routine-card">
            <summary>View private identifiers and contact information</summary>
            {[
              "policy_number",
              "member_number",
              "customer_service_phone",
              "claims_phone",
              "started_on",
              "ended_on",
              "notes",
            ].map((k) => (
              <p key={k}>
                {k === "policy_number" &&
                d.summary.coverageKind === "wellness_program"
                  ? "Plan reference"
                  : k.replaceAll("_", " ")}
                : {String(d.plan[k] || "Not recorded")}
              </p>
            ))}
            {d.plan.portal_url && (
              <a
                href={String(d.plan.portal_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open portal
              </a>
            )}
          </details>
          <TermHistory terms={d.terms} />
          <details className="routine-card">
            <summary>Start new term / correct entered terms</summary>
            <InsuranceForm mode="term" petId={petId} planId={planId} />
          </details>
          <DocumentList documents={d.documents} petId={petId} planId={planId} />
          <DocumentUpload petId={petId} planId={planId} />
          <ClaimList claims={d.claims} base={planBase} />
          <Link href={`${planBase}/claims/new`}>Record a claim</Link>
        </>
      );
  }
  return (
    <AppFrame>
      <main className="care-page">
        <nav className="care-page-links" aria-label="Coverage navigation">
          <Link href={`/pets/${petId}`}>{pet.name}</Link>
          <Link href={base}>Coverage</Link>
          <Link href="/insurance">All pets’ coverage</Link>
        </nav>
        {content}
        <InsuranceNotice />
      </main>
    </AppFrame>
  );
}
