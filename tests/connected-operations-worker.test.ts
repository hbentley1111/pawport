import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createConnectedPipeline,
  reconcileJob,
} from "../supabase/functions/_shared/live-booking/connected-pipeline";
import type { Rpc } from "../supabase/functions/_shared/live-booking/pipeline";
import {
  BookingError,
  type LiveSchedulingAdapter,
  type VendorAppointment,
} from "../supabase/functions/_shared/live-booking/contract";
import { processLiveAvailabilityWatch } from "../lib/openings/live-worker";
const user = randomUUID(),
  appointmentId = randomUUID();
const vendor: VendorAppointment = {
  id: 42,
  externalAppointmentId: "appointment_Test",
  active: true,
  startsAt: "2026-10-10T13:00:00.000Z",
  endsAt: "2026-10-10T13:30:00.000Z",
  modifiedAt: 100,
  animalId: "animal_Test",
  contactId: "contact_Test",
  appointmentTypeId: "appointmentType_Test",
  resourceIds: ["resource_Test"],
};
function setup(mode = "success") {
  const calls: string[] = [];
  let reads = 0;
  const adapter: LiveSchedulingAdapter = {
    system: "ezyvet",
    capabilities: {
      supportsAvailability: true,
      supportsAppointmentCreate: true,
      supportsAppointmentCancel: true,
      supportsAppointmentReschedule: false,
    },
    getCatalog: async () => ({
      site: { id: "site_Test", timeZone: "America/New_York" },
      appointmentTypes: [{ id: vendor.appointmentTypeId, name: "Wellness" }],
      resources: [{ id: vendor.resourceIds[0], name: "Resource" }],
    }),
    listAvailability: async () => [],
    validateConnection: async () => {
      throw Error("unused");
    },
    bookAppointment: async () => {
      throw Error("Must not book");
    },
    getAppointment: async () => {
      calls.push("vendor_GET");
      reads++;
      return {
        ...vendor,
        ...(mode === "conflict" && reads > 1 ? { modifiedAt: 101 } : {}),
      };
    },
    cancelAppointment: async () => {
      calls.push("vendor_PATCH");
      if (mode === "unknown") throw new BookingError("unknown");
      return { ...vendor, active: false };
    },
  };
  const rpc: Rpc = async <T>(name: string): Promise<T> => {
    calls.push(name);
    if (name === "prepare_connected_context")
      return {
        appointmentId,
        connectionId: randomUUID(),
        credentialRef: "EZYVET_CONNECTION_TEST",
        externalAppointmentId: vendor.externalAppointmentId,
        externalPetId: vendor.animalId,
        externalOwnerId: vendor.contactId,
        startsAt: vendor.startsAt,
        endsAt: vendor.endsAt,
        updatedAt: "2026-09-12T12:00Z",
        mutationState: mode === "pending" ? "unknown" : null,
        canCancel: true,
        appointmentTypeId: vendor.appointmentTypeId,
        durationMinutes: 30,
        resourceIds: vendor.resourceIds,
      } as T;
    if (name === "begin_connected_cancellation")
      return { state: "initiated", mutationId: randomUUID() } as T;
    if (name === "complete_connected_cancellation") {
      if (mode === "persist_failure") throw Error("Lost response");
      return { state: "completed", cancelled: true } as T;
    }
    return null as T;
  };
  return {
    calls,
    adapter,
    rpc,
    run: createConnectedPipeline(
      rpc,
      async () => adapter,
      () => Date.parse("2026-09-12T12:00Z"),
    ),
  };
}
test("Cancellation reads exact vendor state twice and checks local conflict before one PATCH", async () => {
  const f = setup();
  assert.deepEqual(
    await f.run(user, { action: "cancel_appointment", appointmentId }),
    { state: "completed", cancelled: true },
  );
  assert.equal(f.calls.filter((c) => c === "vendor_PATCH").length, 1);
  assert.ok(
    f.calls.indexOf("assert_connected_dispatch") <
      f.calls.indexOf("vendor_PATCH"),
  );
  assert.ok(
    f.calls.indexOf("vendor_PATCH") <
      f.calls.indexOf("record_connected_vendor_confirmation"),
  );
  assert.ok(
    f.calls.indexOf("record_connected_vendor_confirmation") <
      f.calls.indexOf("complete_connected_cancellation"),
  );
});
test("Pending mutation and changed vendor cursor block another PATCH", async () => {
  for (const mode of ["pending", "conflict"]) {
    const f = setup(mode);
    if (mode === "pending")
      assert.equal(
        (
          (await f.run(user, {
            action: "cancel_appointment",
            appointmentId,
          })) as { state: string }
        ).state,
        "unknown",
      );
    else
      await assert.rejects(
        f.run(user, { action: "cancel_appointment", appointmentId }),
        /conflict/,
      );
    assert.ok(!f.calls.includes("vendor_PATCH"));
  }
});
test("Ambiguous vendor or post-vendor persistence failures remain unknown", async () => {
  for (const mode of ["unknown", "persist_failure"]) {
    const f = setup(mode);
    await assert.rejects(
      f.run(user, { action: "cancel_appointment", appointmentId }),
      /unknown/,
    );
    assert.equal(f.calls.filter((c) => c === "vendor_PATCH").length, 1);
  }
});
test("Reschedule and Smart Opening moves fail closed without any vendor call", async () => {
  const f = setup();
  for (const action of [
    { action: "reschedule_availability" as const, appointmentId },
    {
      action: "reschedule_appointment" as const,
      appointmentId,
      quoteId: randomUUID(),
    },
    { action: "opening_reschedule_quote" as const, matchId: randomUUID() },
  ])
    await assert.rejects(f.run(user, action), /unsupported/);
  assert.deepEqual(f.calls, []);
});
test("Reconciliation only reads vendor data and sends a bounded normalized observation", async () => {
  const f = setup();
  let observation: Record<string, unknown> = {};
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    assert.equal(name, "reconcile_connected_mutation");
    observation = args;
    return {} as T;
  };
  await reconcileJob(
    {
      mutationId: randomUUID(),
      appointmentId,
      leaseToken: randomUUID(),
      credentialRef: "EZYVET_CONNECTION_TEST",
      externalAppointmentId: vendor.externalAppointmentId,
      numericId: 42,
      externalPetId: vendor.animalId,
      externalOwnerId: vendor.contactId,
      expectedUpdatedAt: "2026-09-12T12:00Z",
    },
    rpc,
    async () => f.adapter,
  );
  assert.equal(observation.p_active, true);
  assert.ok(!f.calls.includes("vendor_PATCH"));
  assert.ok(!JSON.stringify(observation).includes("animal_Test"));
});
test("Live watch processing reuses weekday/time matcher and supplies complete disappearance snapshots", async () => {
  const f = setup(),
    connection = randomUUID();
  let present = true;
  const completions: Record<string, unknown>[] = [];
  f.adapter.listAvailability = async () =>
    present
      ? [
          {
            startsAt: "2026-09-15T13:00:00.000Z",
            endsAt: "2026-09-15T13:30:00.000Z",
            timeZone: "America/New_York",
            resourceId: "resource_Test",
            appointmentTypeId: "appointmentType_Test",
          },
        ]
      : [];
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    if (name === "prepare_live_watch_check")
      return {
        watch: {
          id: randomUUID(),
          process_token: randomUUID(),
          system: "ezyvet",
          status: "active",
          connection_id: connection,
          appointment_type: "veterinary",
          earliest_date: "2026-09-15",
          latest_date: "2026-09-15",
          earliest_time: "08:00",
          latest_time: "12:00",
          allowed_weekdays: [2],
          time_zone: "America/New_York",
          expires_at: "2026-10-01T00:00Z",
          current_appointment_start: "2026-09-20T13:00Z",
        },
        credentialRef: "EZYVET_CONNECTION_TEST",
        connectionId: connection,
        serviceId: randomUUID(),
        pawportType: "veterinary",
        bindingUpdatedAt: "2026-09-12T00:00Z",
        appointmentTypeId: "appointmentType_Test",
        durationMinutes: 30,
        resourceIds: ["resource_Test"],
      } as T;
    completions.push(args);
    return 1 as T;
  };
  const now = () => Date.parse("2026-09-12T12:00Z");
  assert.equal(
    await processLiveAvailabilityWatch(
      randomUUID(),
      rpc,
      async () => f.adapter,
      now,
    ),
    true,
  );
  assert.equal((completions[0].p_slots as unknown[]).length, 1);
  present = false;
  assert.equal(
    await processLiveAvailabilityWatch(
      randomUUID(),
      rpc,
      async () => f.adapter,
      now,
    ),
    true,
  );
  assert.deepEqual(completions[1].p_slots, []);
  assert.equal(completions[1].p_error, false);
  assert.ok(!f.calls.includes("vendor_PATCH"));
});
