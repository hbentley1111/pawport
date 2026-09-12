import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { CarePlan, CareNotification } from "./schema";
export async function carePlans(
  db: Awaited<ReturnType<typeof createClient>>,
  pet?: string,
  id?: string,
  offset = 0,
  limit = 1000,
): Promise<CarePlan[] | null> {
  const { data, error } = await db.rpc("my_care_plans", {
    p_pet: pet || null,
    p_id: id || null,
    p_offset: offset,
    p_limit: limit,
  });
  return error ? null : ((data || []) as CarePlan[]);
}
export async function careNotifications(
  db: Awaited<ReturnType<typeof createClient>>,
): Promise<CareNotification[] | null> {
  const { data, error } = await db.rpc("my_care_notifications");
  return error ? null : ((data || []) as CareNotification[]);
}
