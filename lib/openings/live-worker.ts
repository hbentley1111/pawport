import type { Rpc } from "../../supabase/functions/_shared/live-booking/pipeline";
import type { LiveSchedulingAdapter } from "../../supabase/functions/_shared/live-booking/contract";
import { matchAvailability } from "./matcher";
import type { WorkerWatch } from "./schema";
import { localDate } from "../../supabase/functions/_shared/live-booking/schemas";
type Job = {
  watch: WorkerWatch;
  credentialRef: string;
  connectionId: string;
  serviceId: string;
  pawportType: WorkerWatch["appointment_type"];
  bindingUpdatedAt: string;
  appointmentTypeId: string;
  durationMinutes: number;
  resourceIds: string[];
};
// Callable only by a trusted worker with restricted RPC transport; no browser or public endpoint.
export async function processLiveAvailabilityWatch(
  id: string,
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
  clock = () => Date.now(),
) {
  const job = await rpc<Job | null>("prepare_live_watch_check", {
    p_watch: id,
  });
  if (!job) return false;
  const finish = (slots: unknown[], error = false) =>
    rpc("complete_live_watch_check", {
      p_watch: id,
      p_token: job.watch.process_token,
      p_binding_updated: job.bindingUpdatedAt,
      p_slots: slots,
      p_error: error,
    });
  try {
    const adapter = await resolve(job.credentialRef);
    if (
      adapter.system !== "ezyvet" ||
      !adapter.capabilities.supportsAvailability
    )
      throw Error("Unsupported");
    const catalog = await adapter.getCatalog();
    if (
      !catalog.appointmentTypes.some((t) => t.id === job.appointmentTypeId) ||
      job.resourceIds.some((id) => !catalog.resources.some((r) => r.id === id))
    )
      throw Error("Invalid binding");
    const now = clock(),
      start = [
        new Date(Date.parse(job.watch.earliest_date + "T12:00Z") - 86400000)
          .toISOString()
          .slice(0, 10),
        localDate(now, catalog.site.timeZone),
      ]
        .sort()
        .at(-1)!;
    const dates: string[] = [];
    for (
      let at = Date.parse(start + "T12:00Z");
      at <= Date.parse(job.watch.latest_date + "T12:00Z") + 86400000;
      at += 86400000
    ) {
      dates.push(new Date(at).toISOString().slice(0, 10));
      if (dates.length > 94) throw Error("Window too large");
    }
    const slots = [];
    for (let i = 0; i < dates.length; i += 7) {
      if (clock() - now > 85000) throw Error("Worker deadline");
      const batch = await adapter.listAvailability({
        appointmentTypeId: job.appointmentTypeId,
        durationMinutes: job.durationMinutes,
        resourceIds: job.resourceIds,
        dates: dates.slice(i, i + 7),
        site: catalog.site,
      });
      slots.push(...batch);
      if (slots.length > 100) throw Error("Incomplete snapshot");
    }
    const normalized = slots.map((s) => ({
      externalSlotId: [s.appointmentTypeId, s.resourceId, s.startsAt].join(":"),
      connectionId: job.connectionId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      appointmentType: job.pawportType || "other",
      externalServiceId: job.appointmentTypeId,
      externalResourceId: s.resourceId,
      bookable: true,
    }));
    await finish(matchAvailability(job.watch, normalized, clock()));
    return true;
  } catch {
    await finish([], true);
    return false;
  }
}
export async function processLiveRechecks(
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
) {
  const jobs = await rpc<
    {
      id: string;
      token: string;
      watchIds: string[];
      more: boolean;
      cursor: string | null;
    }[]
  >("lease_live_rechecks", { p_limit: 1 });
  for (const job of jobs) {
    let success = true;
    for (const id of job.watchIds) {
      try {
        if (!(await processLiveAvailabilityWatch(id, rpc, resolve)))
          success = false;
      } catch {
        success = false;
      }
    }
    await rpc("complete_live_recheck", {
      p_id: job.id,
      p_token: job.token,
      p_cursor: job.cursor,
      p_more: job.more,
      p_success: success,
    });
  }
  return jobs.length;
}
