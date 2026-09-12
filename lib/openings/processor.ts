import type {
  SchedulingAdapter,
  SchedulingConnection,
  AvailabilitySlot,
} from "@/lib/care/scheduling-adapter";
import type { WorkerWatch } from "./schema";
import { matchAvailability } from "./matcher";
export interface AvailabilityStore {
  begin(watchId: string): Promise<WorkerWatch | null>;
  complete(
    watchId: string,
    token: string,
    slots: AvailabilitySlot[],
    error?: boolean,
  ): Promise<number>;
}
// One complete availability snapshot per call. Adapters must exhaust vendor pagination within their bound.
export async function processAvailabilityWatch(
  id: string,
  store: AvailabilityStore,
  resolve: (connection: SchedulingConnection) => SchedulingAdapter,
  now = () => Date.now(),
) {
  const watch = await store.begin(id);
  if (!watch) return { checked: false, newNotifications: 0 };
  try {
    const connection = {
      id: watch.connection_id,
      externalSystem: watch.system,
    };
    const adapter = resolve(connection);
    if (
      adapter.system !== connection.externalSystem ||
      !adapter.capabilities.supportsAvailability ||
      !adapter.listAvailability
    )
      throw new Error("Availability unsupported");
    // Broad UTC envelope covers the complete local date range, including DST/non-hour offsets.
    const from = new Date(
      Date.parse(watch.earliest_date + "T00:00:00Z") - 86400000,
    ).toISOString();
    const to = new Date(
      Date.parse(watch.latest_date + "T00:00:00Z") + 2 * 86400000,
    ).toISOString();
    const slots = await adapter.listAvailability(connection, {
      from,
      to,
      type: watch.appointment_type || undefined,
      externalServiceId: watch.external_service_id || undefined,
      externalStaffId: watch.external_staff_id || undefined,
    });
    const matches = matchAvailability(watch, slots, now());
    return {
      checked: true,
      newNotifications: await store.complete(id, watch.process_token, matches),
    };
  } catch {
    await store.complete(id, watch.process_token, [], true);
    return { checked: false, newNotifications: 0 };
  }
}
