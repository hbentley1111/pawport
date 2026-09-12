import "server-only";
import { availabilityImplemented } from "@/lib/openings/data";
import type { createClient } from "@/lib/supabase/server";
import type { NotificationPage } from "./schema";
export const demoNotifications = () =>
  availabilityImplemented("mock", "notification-visibility");
export async function notifications(
  db: Awaited<ReturnType<typeof createClient>>,
  unread = false,
  cursor: NotificationPage["nextCursor"] = null,
) {
  const { data, error } = await db.rpc("my_notifications", {
    p_unread: unread,
    p_before: cursor?.at || null,
    p_before_id: cursor?.id || null,
    p_limit: 25,
    p_demo: demoNotifications(),
  });
  if (error) return null;
  return data as NotificationPage;
}
