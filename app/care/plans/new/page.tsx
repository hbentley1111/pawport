import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { PlanForm } from "@/components/care-plans/form";
import { careContext } from "@/lib/care/data";
export default async function NewPlan({
  searchParams,
}: {
  searchParams: Promise<{ pet?: string }>;
}) {
  const { pets } = await careContext(),
    p = await searchParams;
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="document-link" href="/care/plans">
          Back to care routines
        </Link>
        <header className="care-heading">
          <div>
            <p className="eyebrow">A LITTLE HELP REMEMBERING</p>
            <h1>Add a care routine.</h1>
          </div>
        </header>
        <PlanForm
          pets={pets.map(({ id, name }) => ({ id, name }))}
          selectedPet={pets.some((pet) => pet.id === p.pet) ? p.pet : undefined}
        />
      </main>
    </AppFrame>
  );
}
