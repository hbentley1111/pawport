import Link from "next/link";
import { ownedPet } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { PetNavigation } from "@/components/pet-navigation";
import { PreventiveLoader } from "@/components/preventive-care/client";
export const dynamic = "force-dynamic";
export default async function PetCare({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { pet } = await ownedPet((await params).petId);
  return (
    <AppFrame>
      <main className="care-page">
        <PetNavigation petId={pet.id} active="Care" />
        <header className="care-heading">
          <div>
            <p className="eyebrow">CARE SNAPSHOT</p>
            <h1>{pet.name}’s Care</h1>
            <p>Records, your routines, and topics to discuss.</p>
          </div>
        </header>
        <nav className="care-page-links" aria-label="Care destinations">
          <Link href={`/pets/${pet.id}/care/profile`}>Care profile</Link>
          <Link href={`/pets/${pet.id}/costs`}>Costs &amp; planning</Link>
          <Link href={`/pets/${pet.id}/insurance`}>
            Insurance &amp; coverage
          </Link>
          <Link href="/care/plans">Care plans</Link>
          <Link href="/appointments">Appointments</Link>
          <Link href={`/pets/${pet.id}/records`}>Health records</Link>
        </nav>
        <PreventiveLoader petId={pet.id} />
      </main>
    </AppFrame>
  );
}
