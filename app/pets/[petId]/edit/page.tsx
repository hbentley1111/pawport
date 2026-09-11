import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { PetForm } from "@/components/forms";
import { PetAvatar } from "@/components/pet-avatar";
import { PhotoForm } from "@/components/photo-form";
import { PetNavigation } from "@/components/pet-navigation";
import { ownedPet } from "@/lib/pet-data";
export const dynamic = "force-dynamic";
export default async function EditPet({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { pet } = await ownedPet((await params).petId);
  return (
    <AppFrame>
      <main className="setup-page">
        <div className="records-container">
          <Link className="account-back" href="/">
            ← Your household
          </Link>
          <h1>A little more {pet.name}.</h1>
          <p className="muted">Keep their details feeling like them.</p>
          <PetNavigation petId={pet.id} active="Edit profile" />
          <div className="profile-edit-grid">
            <section className="account-card">
              <h2>Pet details</h2>
              <PetForm pet={pet} />
            </section>
            <section className="account-card profile-photo-card">
              <PetAvatar pet={pet} />
              <h2>Their best face.</h2>
              <p className="muted">
                A familiar face for their private passport.
              </p>
              <PhotoForm petId={pet.id} />
            </section>
          </div>
        </div>
      </main>
    </AppFrame>
  );
}
