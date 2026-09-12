import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppFrame } from "@/components/app-frame";
import { MomentForm, DeleteMoment } from "@/components/timeline/form";
import { JournalPhoto } from "@/components/timeline/photo";
import { ownedPet } from "@/lib/pet-data";
import type { JournalEntry } from "@/lib/timeline/schema";
export default async function Moment({
  params,
}: {
  params: Promise<{ petId: string; entryId: string }>;
}) {
  const { petId, entryId } = await params,
    { pet, db } = await ownedPet(petId);
  if (!z.uuid().safeParse(entryId).success) notFound();
  const r = await db.rpc("my_pet_journal_entry", {
    p_pet: pet.id,
    p_id: entryId,
  });
  if (r.error) throw new Error("Moment temporarily unavailable.");
  if (!r.data) notFound();
  const entry = r.data as JournalEntry;
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="document-link" href={`/pets/${pet.id}/timeline`}>
          Back to {pet.name}’s timeline
        </Link>
        <header className="care-heading">
          <div>
            <p className="eyebrow">OWNER ADDED</p>
            <h1>{entry.title || "Your moment"}</h1>
          </div>
        </header>
        {entry.photo_id && (
          <JournalPhoto
            src={`/pets/${pet.id}/timeline/${entry.id}/photo?v=${entry.photo_id}`}
            title={entry.title || "Private journal photo"}
          />
        )}
        <MomentForm
          petId={pet.id}
          entry={entry}
          currentPhoto={pet.photo_id}
          now={new Date().toISOString()}
        />
        <DeleteMoment id={entry.id} petId={pet.id} />
      </main>
    </AppFrame>
  );
}
