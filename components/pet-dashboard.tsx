import { selectedYear } from "@/lib/costs/data";
import { petCareCostSnapshot } from "@/lib/costs/snapshot";
import type { Summary } from "@/lib/costs/schema";
import { petTimeline } from "@/lib/timeline/data";
import { carePlans } from "@/lib/care-plans/data";
import { openingsData } from "@/lib/openings/data";
import { upcomingCare } from "@/lib/care/data";
import { ownedPet } from "@/lib/pet-data";
import { accountProfile } from "@/lib/account";
import type { Trust } from "@/lib/records";
import { Dashboard } from "./dashboard";
export async function PetDashboard({ petId }: { petId: string }) {
  const { pet, db, user } = await ownedPet(petId);
  const costYear = await selectedYear(undefined);
  const [h, v, s, t, care, openings, routines, timeline, coverage, costs] =
    await Promise.all([
      db.from("households").select("name").eq("id", pet.household_id).single(),
      db
        .from("vaccinations")
        .select("*")
        .eq("pet_id", pet.id)
        .order("administered_on", { ascending: false }),
      db
        .from("share_passes")
        .select("id,expires_at,revoked_at,created_at")
        .eq("pet_id", pet.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
      db.rpc("owner_vaccination_trust", { p_pet: pet.id }),
      upcomingCare(db, pet.household_id, pet.id),
      openingsData(db),
      carePlans(db, pet.id),
      petTimeline(db, pet.id, "all", null, 3),
      db.rpc("my_pet_coverage_plans", { p_pet: pet.id }),
      db.rpc("my_pet_cost_summary", { p_pet: pet.id, p_year: costYear }),
    ]);
  if (h.error || v.error || s.error || t.error)
    throw new Error("Unable to load this pet’s passport.");
  const trust = new Map<string | undefined, Trust>(
    (t.data || []).map((item: Trust) => [item.vaccination_id, item]),
  );
  let costSnapshot = null;
  if (!costs.error && costs.data) {
    try {
      costSnapshot = petCareCostSnapshot(
        costs.data as Summary,
        pet.id,
        costYear,
      );
    } catch {
      /* A failed snapshot must not hide the passport. */
    }
  }
  return (
    <Dashboard
      pet={pet}
      costSnapshot={costSnapshot}
      costYear={costYear}
      vaccinations={(v.data || []).map((item) => ({
        ...item,
        ...trust.get(item.id),
      }))}
      passes={s.data || []}
      household={h.data.name}
      accountName={
        accountProfile(user.user_metadata).full_name || "Your account"
      }
      recentActivity={timeline?.events || null}
      coveragePlans={coverage.error ? null : coverage.data}
      carePlans={routines}
      appointments={care}
      openings={openings.watches}
      demo={false}
    />
  );
}
