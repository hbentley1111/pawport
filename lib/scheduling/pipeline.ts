import type {
  SchedulingAdapter,
  SchedulingConnection,
  SchedulingEvent,
  WebhookRequest,
} from "@/lib/care/scheduling-adapter";
import { schedulingEventSchema } from "./schema";
// Inject a dedicated worker transport. Never use an owner Supabase client or browser-supplied connection.
export interface SchedulingStore {
  recordRun(connectionId: string, success: boolean): Promise<void>;
  importEvent(connectionId: string, event: SchedulingEvent): Promise<string>;
  recordFailure(
    connectionId: string,
    code: "unavailable" | "invalid_event",
  ): Promise<void>;
}
export async function ingestWebhook(
  adapter: SchedulingAdapter,
  connection: SchedulingConnection,
  request: WebhookRequest,
  store: SchedulingStore,
) {
  if (
    adapter.system !== connection.externalSystem ||
    !adapter.capabilities.supportsWebhooks ||
    !adapter.verifyWebhook ||
    !adapter.normalizeWebhookEvent
  )
    throw new Error("Unsupported webhook");
  // Verification is outside failure logging: unauthenticated traffic cannot change connection health.
  const verified = await adapter.verifyWebhook(connection, request);
  const normalized = schedulingEventSchema.parse(
    adapter.normalizeWebhookEvent(verified),
  );
  return store.importEvent(connection.id, normalized);
}
export async function syncAppointments(
  adapter: SchedulingAdapter,
  connection: SchedulingConnection,
  window: { from: string; to: string },
  store: SchedulingStore,
) {
  if (
    adapter.system !== connection.externalSystem ||
    !adapter.capabilities.supportsAppointmentRead ||
    !adapter.listAppointments ||
    !adapter.normalizeAppointment
  )
    throw new Error("Unsupported sync");
  if (
    !Number.isFinite(Date.parse(window.from)) ||
    !Number.isFinite(Date.parse(window.to)) ||
    Date.parse(window.to) < Date.parse(window.from) ||
    Date.parse(window.to) - Date.parse(window.from) > 366 * 86400000
  )
    throw new Error("Invalid sync window");
  let cursor: string | undefined;
  const results: string[] = [];
  const cursors = new Set<string>();
  try {
    await store.recordRun(connection.id, false);
    for (let page = 0; page < 10; page++) {
      const batch = await adapter.listAppointments(connection, {
        ...window,
        cursor,
      });
      if (batch.appointments.length > 100) throw new Error("Page limit");
      for (const a of batch.appointments) {
        const event = schedulingEventSchema.parse(
          adapter.normalizeAppointment(a, `poll:${a.externalId}:${a.version}`),
        );
        results.push(await store.importEvent(connection.id, event));
      }
      if (!batch.nextCursor) {
        await store.recordRun(connection.id, true);
        return results;
      }
      if (cursors.has(batch.nextCursor)) throw new Error("Repeated cursor");
      cursors.add(batch.nextCursor);
      cursor = batch.nextCursor;
    }
    throw new Error("Sync limit");
  } catch {
    await store.recordFailure(connection.id, "unavailable");
    throw new Error("Scheduling sync unavailable");
  }
}
