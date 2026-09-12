import { AppFrame } from "@/components/app-frame";
import { TodayDashboard } from "@/components/today/dashboard";
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
  if (!household) {
    const { data: memberships } = await db
      .from("provider_memberships")
      .select("provider_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .limit(1);
    if (memberships?.length) redirect("/provider");
    redirect("/onboarding");
  }
  const { data: pets, error: pError } = await db
    .from("pets")
    .select("*")
    .eq("household_id", household.id)
    .order("created_at")
    .order("id");
  if (pError) throw new Error("Unable to load pets.");
  if (!pets?.length) redirect("/onboarding");
  return (
    <AppFrame>
      <TodayDashboard
        household={household.name}
        pets={pets.map(({ id, name, species, photo_id }) => ({
          id,
          name,
          species,
          photo_id,
        }))}
      />
    </AppFrame>
  );
}
