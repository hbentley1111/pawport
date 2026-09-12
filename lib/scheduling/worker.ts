import "server-only";
import type { SchedulingStore } from "./pipeline";
// Supply a separately authenticated RPC transport restricted to pawport_scheduling_worker.
// No service-role client, credentials, public route or scheduler is created by this foundation.
export function workerStore(
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
): SchedulingStore {
  return {
    async recordRun(connectionId, success) {
      const r = await rpc("record_scheduling_run", {
        p_connection: connectionId,
        p_success: success,
      });
      if (r.error) throw new Error("Sync run update failed");
    },
    async importEvent(connectionId, event) {
      const r = await rpc("import_scheduling_event", {
        p_connection: connectionId,
        p_event: event,
      });
      if (r.error) throw new Error("Import failed");
      return String(r.data);
    },
    async recordFailure(connectionId, code) {
      const r = await rpc("record_scheduling_failure", {
        p_connection: connectionId,
        p_code: code,
      });
      if (r.error) throw new Error("Health update failed");
    },
  };
}
