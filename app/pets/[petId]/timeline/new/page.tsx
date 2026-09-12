import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { MomentForm } from "@/components/timeline/form";
import { ownedPet } from "@/lib/pet-data";
export default async function NewMoment({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { petId } = await params,
    { pet } = await ownedPet(petId);
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="document-link" href={`/pets/${pet.id}/timeline`}>
          Back to {pet.name}’s timeline
        </Link>
        <header className="care-heading">
          <div>
            <p className="eyebrow">{pet.name}’S STORY</p>
            <h1>Add a moment.</h1>
            <p className="muted">A little piece of their story.</p>
          </div>
        </header>
        <MomentForm
          petId={pet.id}
          currentPhoto={pet.photo_id}
          now={new Date().toISOString()}
        />
      </main>
    </AppFrame>
  );
}
