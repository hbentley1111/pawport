import { careContext } from "@/lib/care/data";
import { HouseholdDashboard } from "@/components/household-dashboard";
export const dynamic = "force-dynamic";
export default async function Pets() {
  const { db, pets, household } = await careContext();
  const [name, v] = await Promise.all([
    db.from("households").select("name").eq("id", household.id).single(),
    db
      .from("vaccinations")
      .select("*")
      .in(
        "pet_id",
        pets.map((p) => p.id),
      ),
  ]);
  if (name.error || v.error) throw new Error("Pets temporarily unavailable");
  return (
    <HouseholdDashboard
      household={name.data.name}
      pets={pets}
      vaccinations={v.data || []}
      recordsMode={false}
      showCareSummary={false}
    />
  );
}
