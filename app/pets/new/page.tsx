import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/dashboard";
import { PetForm } from "@/components/forms";
import { ownerSession } from "@/lib/pet-data";
import { MAX_PETS } from "@/lib/pets";
export const dynamic = "force-dynamic";
export default async function NewPet() {
  const { db, user } = await ownerSession();
  const { data: h, error } = await db
    .from("households")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to load household.");
  if (!h) redirect("/onboarding");
  const { count, error: countError } = await db
    .from("pets")
    .select("id", { count: "exact", head: true })
    .eq("household_id", h.id);
  if (countError) throw new Error("Unable to load pets.");
  return (
    <main className="setup-page">
      <Brand />
      <div className="setup-card">
        <Link className="account-back" href="/">
          ← Your household
        </Link>
        <p className="eyebrow">A LITTLE MORE LOVE</p>
        <h1>Meet your new companion.</h1>
        <p className="muted">
          Their own passport, right here with the family. Add a photo after
          saving their details.
        </p>
        {(count || 0) >= MAX_PETS ? (
          <p role="status">Your household has reached its limit of 20 pets.</p>
        ) : (
          <PetForm />
        )}
      </div>
    </main>
  );
}
