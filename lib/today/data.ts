import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { availabilityImplemented } from "@/lib/openings/data";
import { demoNotifications } from "@/lib/notifications/data";
import { validTimeZone } from "@/lib/care/time";
import {
  combineToday,
  type TodayResult,
  type PawportTodayItem,
} from "./schema";
export async function getPawportToday(
  db: Awaited<ReturnType<typeof createClient>>,
  zone: string,
) {
  if (zone.length > 100 || !validTimeZone(zone))
    throw new Error("Invalid time zone");
  const systems = (
    ["mock", "ezyvet", "daysmart", "gingr", "moego"] as const
  ).filter((s) => availabilityImplemented(s, "today-capabilities"));
  const [core, opening, count, renewals] = await Promise.all([
    db.rpc("my_pawport_today", { p_zone: zone }),
    db.rpc("my_today_openings", { p_systems: systems }),
    db.rpc("my_notification_count", { p_demo: demoNotifications() }),
    db.rpc("my_insurance_renewals", { p_zone: zone }),
  ]);
  if (core.error || opening.error || count.error)
    throw new Error("Today temporarily unavailable");
  return combineToday(
    {
      ...(core.data as TodayResult),
      insuranceRenewals: renewals.error ? [] : renewals.data,
    },
    opening.data as { count: number; items: PawportTodayItem[] },
    Number(count.data),
    zone,
  );
}
