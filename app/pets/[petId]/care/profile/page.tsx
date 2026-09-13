import Link from "next/link";
import { ownedPet } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { PreventiveProfileForm } from "@/components/preventive-care/client";
import type { PreventiveProfile } from "@/lib/preventive-care/schema";
export const dynamic = "force-dynamic";
export default async function Profile({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { pet, db } = await ownedPet((await params).petId);
  const { data, error } = await db.rpc("my_pet_preventive_profile", {
    p_pet: pet.id,
  });
  if (error) throw Error("Care profile unavailable");
  return (
    <AppFrame>
      <main className="care-page">
        <Link href={`/pets/${pet.id}/care`}>Back to {pet.name}’s care</Link>
        <h1>Care profile</h1>
        <p>
          Help PetThread organize topics you may want to discuss with your
          veterinarian.
        </p>
        <p>
          These optional answers are a private reminder for you. They do not
          change the guidance or create medical recommendations.
        </p>
        <PreventiveProfileForm
          petId={pet.id}
          profile={data as PreventiveProfile | null}
        />
      </main>
    </AppFrame>
  );
}
