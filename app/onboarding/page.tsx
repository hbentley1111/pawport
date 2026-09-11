import { redirect } from "next/navigation";
import { Brand } from "@/components/dashboard";
import { HouseholdForm, PetForm } from "@/components/forms";
import { createClient, configured } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function Onboarding() {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: h, error } = await db
    .from("households")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to load household.");
  if (h) {
    const { count, error } = await db
      .from("pets")
      .select("id", { count: "exact", head: true })
      .eq("household_id", h.id);
    if (error) throw new Error("Unable to load pet.");
    if (count) redirect("/");
  }
  return (
    <main className="setup-page">
      <Brand />
      <div className="setup-card">
        <p className="eyebrow">
          STEP {h ? "2" : "1"} OF 2 · MAKE YOURSELF AT HOME
        </p>
        <h1>
          {h ? "Meet your little companion." : "A home for their health."}
        </h1>
        <p className="muted">
          {h
            ? "A few details, and their passport is ready."
            : "Start with a name for your household. Only you can access it."}
        </p>
        {h ? <PetForm /> : <HouseholdForm />}
      </div>
    </main>
  );
}
