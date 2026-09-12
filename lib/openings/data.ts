import "server-only";
import { schedulingAdapter } from "@/lib/scheduling/registry";
import type { SchedulingSystem } from "@/lib/care/scheduling-adapter";
import { ownerSession } from "@/lib/pet-data";
import type { WatchContext, WatchSummary, OpeningNotification } from "./schema";
// Registry is the capability source of truth. No vendor identifiers in matcher or processor logic.
export function availabilityImplemented(
  system: SchedulingSystem,
  connectionId: string,
) {
  try {
    const adapter = schedulingAdapter(system, connectionId);
    return Boolean(
      adapter.capabilities.supportsAvailability && adapter.listAvailability,
    );
  } catch {
    return false;
  }
}
export async function watchContext(
  db: Awaited<ReturnType<typeof ownerSession>>["db"],
  id: string,
) {
  const { data, error } = await db.rpc("availability_appointment_context", {
    p_appointment: id,
  });
  if (error || !data) return null;
  const c = data as WatchContext;
  return availabilityImplemented(c.system, c.connection_id) ? c : null;
}
export async function openingsData(
  db: Awaited<ReturnType<typeof ownerSession>>["db"],
) {
  const [w, n] = await Promise.all([
    db.rpc("my_availability_watches"),
    db.rpc("my_availability_notifications"),
  ]);
  const visible = (system: SchedulingSystem) =>
    system !== "mock" || availabilityImplemented(system, "visibility-check");
  const watches = ((w.data || []) as WatchSummary[])
    .filter((x) => visible(x.system))
    .map((x) => {
      if (availabilityImplemented(x.system, "visibility-check")) return x;
      return {
        ...x,
        status: (["expired", "cancelled", "paused"].includes(x.status)
          ? x.status
          : "connection_unavailable") as WatchSummary["status"],
        matches: x.matches.map((m) => ({
          ...m,
          status: (["available", "notified"].includes(m.status)
            ? "unavailable"
            : m.status) as typeof m.status,
        })),
      };
    });
  return {
    error: Boolean(w.error || n.error),
    watches,
    notifications: ((n.data || []) as OpeningNotification[]).filter((x) =>
      visible(x.system),
    ),
  };
}
