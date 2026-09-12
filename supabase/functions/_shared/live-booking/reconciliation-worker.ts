import type { Rpc } from "./pipeline.ts";
import type { LiveSchedulingAdapter } from "./contract.ts";
import { reconcileJob, type ReconciliationJob } from "./connected-pipeline.ts";
// Protected scheduler/queue entry point; intentionally not exposed as an HTTP action.
export async function reconcileUnknownLiveMutations(
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
) {
  const jobs = await rpc<ReconciliationJob[]>(
    "lease_connected_reconciliation",
    { p_limit: 5 },
  );
  for (const job of jobs) await reconcileJob(job, rpc, resolve);
  return jobs.length;
}
