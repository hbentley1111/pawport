import "server-only";
import { ownerSession } from "@/lib/pet-data";
import { redirect } from "next/navigation";
import { activeStatuses, type Appointment } from "./schema";
import type { Pet } from "@/lib/types";
export const careFields =
  "id,pet_id,source,booking_origin,sync_state,title,appointment_type,starts_at,ends_at,time_zone,status,provider_name,location_text,google_place_id,updated_at,appointment_reminders(id,reminder_minutes,dismissed_at)";
export async function careContext() {
  const { db, user } = await ownerSession();
  const { data: household, error } = await db
    .from("households")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to load your household.");
  if (!household) redirect("/");
  const pets = await db
    .from("pets")
    .select("*")
    .eq("household_id", household.id)
    .order("created_at")
    .order("id");
  if (pets.error) throw new Error("Unable to load pets.");
  return { db, pets: (pets.data || []) as Pet[], household };
}
export async function upcomingCare(
  db: Awaited<ReturnType<typeof ownerSession>>["db"],
  householdId: string,
  petId?: string,
) {
  let q = db
    .from("appointments")
    .select(careFields)
    .eq("household_id", householdId)
    .in("status", activeStatuses)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .order("id")
    .limit(petId ? 3 : 5);
  if (petId) q = q.eq("pet_id", petId);
  const result = await q;
  return result.error
    ? null
    : ((result.data || []) as unknown as Appointment[]);
}
