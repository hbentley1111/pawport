import type { Trust } from "@/lib/records";
import { accountProfile } from "@/lib/account";
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
  const { data: trust, error: trustError } = await db.rpc(
    "owner_vaccination_trust",
    { p_pet: pet.id },
  );
  if (trustError)
    throw new Error(
      "Unable to load record trust. Apply the verified-records migration.",
    );
  const enriched = (vaccinations || []).map((v) => ({
    ...v,
    ...(((trust as Trust[]) || []).find((t) => t.vaccination_id === v.id) ||
      {}),
  }));
  return (
    <Dashboard
      pet={pet}
      vaccinations={enriched}
      passes={passes ?? []}
      household={household.name}
      accountName={
        accountProfile(user.user_metadata).full_name || "Your account"
      }
      demo={false}
    />
  );
}
