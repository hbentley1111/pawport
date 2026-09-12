import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { PreventiveCare, PreventiveSummary } from "./schema";
export async function preventiveCare(
  db: Awaited<ReturnType<typeof createClient>>,
  petId: string,
  zone: string,
) {
  const { data, error } = await db.rpc("my_pet_preventive_care", {
    p_pet: petId,
    p_zone: zone,
  });
  if (error || !data) throw Error("Preventive care unavailable");
  return data as PreventiveCare;
}
export async function preventiveSummary(
  db: Awaited<ReturnType<typeof createClient>>,
  zone: string,
) {
  const { data, error } = await db.rpc("my_preventive_care_summary", {
    p_zone: zone,
  });
  if (error) throw Error("Preventive care unavailable");
  return data as PreventiveSummary[];
}
