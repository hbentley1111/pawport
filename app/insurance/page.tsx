import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { ownerSession } from "@/lib/pet-data";
import { insuranceRpc } from "@/lib/insurance/data";
import type { InsurancePet } from "@/lib/insurance/schema";
import {
  CoverageCard,
  InsuranceNotice,
} from "@/components/insurance/presentation";
export const dynamic = "force-dynamic";
export default async function InsuranceHome() {
  const { db } = await ownerSession();
  const pets = await insuranceRpc<InsurancePet[]>(db, "my_insurance_summary");
  return (
    <AppFrame>
      <main className="care-page">
        <h1>Insurance &amp; coverage</h1>
        <Link href="/costs">Costs &amp; planning</Link>
        <InsuranceNotice />
        {!pets.length && <p>Add a pet to organize coverage information.</p>}
        {pets.map((p) => (
          <section className="routine-summary" key={p.petId}>
            <h2>{p.petName}</h2>
            <p>{p.openClaimCount} open claims</p>
            {p.plans.map((plan) => (
              <CoverageCard key={plan.planId} plan={plan} />
            ))}
            {!p.plans.length && <p>No coverage information added.</p>}
            <Link
              className="document-link"
              href={`/pets/${p.petId}/insurance/new`}
            >
              Add insurance or wellness plan
            </Link>
          </section>
        ))}
      </main>
    </AppFrame>
  );
}
