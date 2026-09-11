import { redirect } from "next/navigation";
import { createClient, configured } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
import { demoPet, demoVaccinations } from "@/lib/demo";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!configured())
    return (
      <Dashboard
        pet={demoPet}
        vaccinations={demoVaccinations}
        passes={[]}
        household="Miller household"
        demo
      />
    );
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: household, error: hError } = await db
    .from("households")
    .select("id,name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (hError) throw new Error("Unable to load household.");
  if (!household) redirect("/onboarding");
  const { data: pet, error: pError } = await db
    .from("pets")
    .select("*")
    .eq("household_id", household.id)
    .maybeSingle();
  if (pError) throw new Error("Unable to load passport.");
  if (!pet) redirect("/onboarding");
  const [
    { data: vaccinations, error: vError },
    { data: passes, error: sError },
  ] = await Promise.all([
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
  ]);
  if (vError || sError) throw new Error("Unable to load health records.");
  return (
    <Dashboard
      pet={pet}
      vaccinations={vaccinations ?? []}
      passes={passes ?? []}
      household={household.name}
      demo={false}
    />
  );
}
