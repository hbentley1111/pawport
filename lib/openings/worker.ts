import "server-only";
import { schedulingAdapter } from "@/lib/scheduling/registry";
import { processAvailabilityWatch, type AvailabilityStore } from "./processor";
import type { WorkerWatch } from "./schema";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
export function availabilityStore(rpc: Rpc): AvailabilityStore {
  return {
    async begin(id) {
      const r = await rpc("begin_availability_check", { p_watch: id });
      if (r.error) throw new Error("Availability check unavailable");
      return r.data as WorkerWatch | null;
    },
    async complete(id, token, slots, error = false) {
      const r = await rpc("complete_availability_check", {
        p_watch: id,
        p_token: token,
        p_slots: slots,
        p_error: error,
      });
      if (r.error) throw new Error("Availability result not saved");
      return Number(r.data);
    },
  };
}
// Future cron/queue/webhook refresh passes only a trusted watch ID and restricted worker RPC transport.
export function runAvailabilityWatch(id: string, rpc: Rpc) {
  return processAvailabilityWatch(id, availabilityStore(rpc), (c) =>
    schedulingAdapter(c.externalSystem, c.id),
  );
}
