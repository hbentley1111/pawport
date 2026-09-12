import {
  BookingError,
  type LiveSchedulingAdapter,
  type VendorAppointment,
} from "./contract.ts";
import type { Rpc } from "./pipeline.ts";
import { nextSevenDates } from "./schemas.ts";
export type ConnectedAction =
  | {
      action:
        | "cancel_appointment"
        | "appointment_operations"
        | "reconcile_appointment"
        | "reschedule_availability";
      appointmentId: string;
    }
  | { action: "reschedule_appointment"; appointmentId: string; quoteId: string }
  | { action: "opening_reschedule_quote"; matchId: string };
type Context = {
  appointmentId: string;
  connectionId: string;
  credentialRef: string;
  externalAppointmentId: string;
  externalPetId: string;
  externalOwnerId: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  mutationState: string | null;
  canCancel: boolean;
  appointmentTypeId: string;
  durationMinutes: number;
  resourceIds: string[];
};
export type ReconciliationJob = {
  mutationId: string;
  appointmentId: string;
  leaseToken: string;
  credentialRef: string;
  externalAppointmentId: string;
  numericId: number;
  externalPetId: string;
  externalOwnerId: string;
  expectedUpdatedAt: string;
};
export async function reconcileJob(
  job: ReconciliationJob,
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
) {
  let observed: VendorAppointment | undefined;
  try {
    const adapter = await resolve(job.credentialRef);
    if (adapter.system !== "ezyvet" || !adapter.getAppointment)
      throw new BookingError("unsupported");
    observed = await adapter.getAppointment(
      job.externalAppointmentId,
      job.numericId,
    );
    if (
      observed.animalId !== job.externalPetId ||
      observed.contactId !== job.externalOwnerId
    )
      observed = undefined;
  } catch {
    /* Inconclusive reads never become a successful mutation. */
  }
  return rpc("reconcile_connected_mutation", {
    p_mutation: job.mutationId,
    p_token: job.leaseToken,
    p_expected_updated: job.expectedUpdatedAt,
    p_active: observed?.active ?? null,
    p_modified: observed?.modifiedAt ?? null,
  });
}
export function createConnectedPipeline(
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
  clock = () => Date.now(),
) {
  return async (user: string, action: ConnectedAction): Promise<unknown> => {
    // Current OpenAPI has no documented time/resource PATCH fields. No vendor call or quote.
    if (
      action.action === "reschedule_availability" ||
      action.action === "reschedule_appointment" ||
      action.action === "opening_reschedule_quote"
    )
      throw new BookingError("unsupported");
    if (action.action === "reconcile_appointment") {
      const jobs = await rpc<ReconciliationJob[]>(
        "lease_connected_reconciliation",
        { p_user: user, p_appointment: action.appointmentId, p_limit: 1 },
      );
      if (!jobs.length) return { state: "unknown", cancelled: false };
      return reconcileJob(jobs[0], rpc, resolve);
    }
    const c = await rpc<Context>("prepare_connected_context", {
      p_user: user,
      p_appointment: action.appointmentId,
    });
    if (c.mutationState)
      return {
        appointmentId: action.appointmentId,
        canCancel: false,
        canReschedule: false,
        mutationState: "unknown",
        state: "unknown",
      };
    const adapter = await resolve(c.credentialRef);
    if (
      adapter.system !== "ezyvet" ||
      !adapter.capabilities.supportsAppointmentCancel ||
      !adapter.cancelAppointment ||
      !adapter.getAppointment
    )
      throw new BookingError("unsupported");
    // Refresh the inherited booking validation and the mutation read permission without a test PATCH.
    const catalog = await adapter.getCatalog();
    if (
      !catalog.appointmentTypes.some((t) => t.id === c.appointmentTypeId) ||
      c.resourceIds.some((id) => !catalog.resources.some((r) => r.id === id))
    )
      throw new BookingError("unavailable");
    await adapter.listAvailability({
      appointmentTypeId: c.appointmentTypeId,
      durationMinutes: c.durationMinutes,
      resourceIds: c.resourceIds,
      dates: [nextSevenDates(clock(), catalog.site.timeZone)[0]],
      site: catalog.site,
    });
    await rpc("record_live_connection_validation", {
      p_connection: c.connectionId,
      p_zone: catalog.site.timeZone,
    });
    const vendor = await adapter.getAppointment(c.externalAppointmentId);
    if (
      !vendor.active ||
      vendor.animalId !== c.externalPetId ||
      vendor.contactId !== c.externalOwnerId ||
      Date.parse(vendor.startsAt) !== Date.parse(c.startsAt) ||
      Date.parse(vendor.endsAt) !== Date.parse(c.endsAt)
    )
      throw new BookingError("conflict");
    await rpc("record_appointment_mutation_validation", {
      p_connection: c.connectionId,
    });
    if (action.action === "appointment_operations")
      return {
        appointmentId: action.appointmentId,
        canCancel: c.canCancel,
        canReschedule: false,
        mutationState: null,
      };
    const mutation = await rpc<{ state: string; mutationId: string }>(
      "begin_connected_cancellation",
      {
        p_user: user,
        p_appointment: action.appointmentId,
        p_expected_updated: c.updatedAt,
        p_numeric_id: vendor.id,
        p_vendor_modified: vendor.modifiedAt,
      },
    );
    if (mutation.state !== "initiated") throw new BookingError("unknown");
    let vendorConfirmed = false;
    try {
      // A second exact read detects vendor-side changes before the write; no undocumented If-Match header.
      const latest = await adapter.getAppointment(
        c.externalAppointmentId,
        vendor.id,
      );
      if (
        !latest.active ||
        latest.modifiedAt !== vendor.modifiedAt ||
        latest.startsAt !== vendor.startsAt ||
        latest.endsAt !== vendor.endsAt ||
        latest.animalId !== vendor.animalId ||
        latest.contactId !== vendor.contactId ||
        latest.appointmentTypeId !== vendor.appointmentTypeId ||
        JSON.stringify([...latest.resourceIds].sort()) !==
          JSON.stringify([...vendor.resourceIds].sort())
      )
        throw new BookingError("conflict");
      await rpc("assert_connected_dispatch", {
        p_user: user,
        p_mutation: mutation.mutationId,
      });
      await adapter.cancelAppointment(latest);
      vendorConfirmed = true;
      await rpc("record_connected_vendor_confirmation", {
        p_user: user,
        p_mutation: mutation.mutationId,
      });
      return await rpc("complete_connected_cancellation", {
        p_user: user,
        p_mutation: mutation.mutationId,
      });
    } catch (error) {
      const code = vendorConfirmed
        ? "unknown"
        : error instanceof BookingError
          ? error.code
          : "unknown";
      try {
        await rpc("fail_connected_mutation", {
          p_user: user,
          p_mutation: mutation.mutationId,
          p_code: code,
        });
      } catch {
        /* Persisted unresolved state prevents retry. */
      }
      throw new BookingError(code);
    }
  };
}
