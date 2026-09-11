import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { HouseholdDashboard } from "@/components/household-dashboard";
export const dynamic = "force-dynamic";
// Legacy bookmark: only select automatically when exactly one pet exists.
export default async function Records() {
  const { db, user } = await ownerSession();
  const { data: h, error: hError } = await db
    .from("households")
    .select("id,name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (hError) throw new Error("Unable to load household.");
  if (!h) redirect("/");
  const { data: pets, error } = await db
    .from("pets")
    .select("*")
    .eq("household_id", h.id)
    .order("created_at")
    .order("id");
  if (error) throw new Error("Unable to load pets.");
  if (!pets?.length) redirect("/onboarding");
  if (pets.length === 1) redirect(`/pets/${pets[0].id}/records`);
  const { data: vaccinations, error: vError } = await db
    .from("vaccinations")
    .select("*")
    .in(
      "pet_id",
      pets.map((p) => p.id),
    );
  if (vError) throw new Error("Unable to load vaccination summaries.");
  return (
    <HouseholdDashboard
      household={h.name}
      pets={pets}
      vaccinations={vaccinations || []}
      recordsMode
    />
  );
}
