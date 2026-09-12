import test from "node:test";
import assert from "node:assert/strict";
import { matchAvailability } from "../lib/openings/matcher";
import { processAvailabilityWatch } from "../lib/openings/processor";
import type { WatchConstraints } from "../lib/openings/schema";
import type { AvailabilitySlot } from "../lib/care/scheduling-adapter";
import { MockSchedulingAdapter } from "../lib/scheduling/mock";
const id = "123e4567-e89b-42d3-a456-426614174000";
const watch: WatchConstraints = {
  connection_id: id,
  appointment_type: "veterinary",
  earliest_date: "2027-10-01",
  latest_date: "2027-10-19",
  earliest_time: "15:00",
  latest_time: "18:00",
  allowed_weekdays: [1, 2, 3, 4, 5],
  current_appointment_start: "2027-10-20T20:00:00Z",
  time_zone: "America/New_York",
  expires_at: "2027-10-20T20:00:00Z",
};
const slot: AvailabilitySlot = {
  connectionId: id,
  externalSlotId: "slot",
  startsAt: "2027-10-06T19:30:00Z",
  endsAt: "2027-10-06T20:00:00Z",
  appointmentType: "veterinary",
  bookable: true,
  externalServiceId: "service",
  externalStaffId: "staff",
};
const now = Date.parse("2027-09-20T12:00:00Z");
test("earlier slots match all constraints in watch timezone and are deduplicated", () => {
  assert.equal(
    matchAvailability(
      watch,
      [slot, { ...slot, startsAt: "2027-10-06T15:30:00-04:00" }],
      now,
    ).length,
    1,
  );
  for (const patch of [
    { bookable: false },
    { connectionId: "123e4567-e89b-42d3-a456-426614174001" },
    { appointmentType: "grooming" as const },
    { startsAt: "2027-10-21T19:30:00Z", endsAt: "2027-10-21T20:00:00Z" },
    { startsAt: "2027-10-09T19:30:00Z", endsAt: "2027-10-09T20:00:00Z" },
    { startsAt: "2027-10-06T12:00:00Z", endsAt: "2027-10-06T13:00:00Z" },
  ])
    assert.equal(
      matchAvailability(watch, [{ ...slot, ...patch }], now).length,
      0,
    );
  assert.equal(
    matchAvailability(
      { ...watch, current_appointment_start: slot.startsAt },
      [slot],
      now,
    ).length,
    0,
  );
  assert.equal(
    matchAvailability({ ...watch, earliest_date: "2027-10-07" }, [slot], now)
      .length,
    0,
  );
  assert.equal(
    matchAvailability({ ...watch, external_service_id: "other" }, [slot], now)
      .length,
    0,
  );
  assert.equal(
    matchAvailability({ ...watch, external_staff_id: "other" }, [slot], now)
      .length,
    0,
  );
  assert.equal(
    matchAvailability(
      { ...watch, external_service_id: "service", external_staff_id: "staff" },
      [slot],
      now,
    ).length,
    1,
  );
  assert.equal(
    matchAvailability(
      { ...watch, earliest_time: "15:30", latest_time: "15:30" },
      [slot],
      now,
    ).length,
    1,
  );
  assert.equal(matchAvailability(watch, [], now).length, 0);
  assert.throws(() =>
    matchAvailability(watch, [{ ...slot, rawVendorPayload: "private" }], now),
  );
});
test("weekends and UTC/local-day boundaries use local calendar weekdays", () => {
  const s = {
    ...slot,
    startsAt: "2027-10-10T02:00:00Z",
    endsAt: "2027-10-10T02:30:00Z",
  }; // Saturday 7 PM in LA
  const w = {
    ...watch,
    time_zone: "America/Los_Angeles",
    earliest_time: "19:00",
    latest_time: "20:00",
    allowed_weekdays: [6],
    earliest_date: "2027-10-09",
    latest_date: "2027-10-09",
  };
  assert.equal(matchAvailability(w, [s], now).length, 1);
  assert.equal(
    matchAvailability({ ...w, allowed_weekdays: [0] }, [s], now).length,
    0,
  );
});
test("DST repeated hours both match; nonexistent wall times are never invented", () => {
  const w = {
    ...watch,
    earliest_date: "2027-11-07",
    latest_date: "2027-11-07",
    earliest_time: "01:00",
    latest_time: "02:00",
    allowed_weekdays: [0],
    current_appointment_start: null,
    expires_at: "2027-11-08T00:00:00Z",
  };
  const first = {
      ...slot,
      startsAt: "2027-11-07T05:30:00Z",
      endsAt: "2027-11-07T05:45:00Z",
    },
    second = {
      ...slot,
      startsAt: "2027-11-07T06:30:00Z",
      endsAt: "2027-11-07T06:45:00Z",
    };
  assert.equal(matchAvailability(w, [first, second], now).length, 2);
  const spring = {
    ...w,
    earliest_date: "2027-03-14",
    latest_date: "2027-03-14",
    earliest_time: "02:00",
    latest_time: "02:59",
    expires_at: "2027-03-15T00:00:00Z",
  };
  assert.equal(
    matchAvailability(
      spring,
      [
        {
          ...slot,
          startsAt: "2027-03-14T07:30:00Z",
          endsAt: "2027-03-14T08:00:00Z",
        },
      ],
      Date.parse("2027-03-01Z"),
    ).length,
    0,
  );
});
test("processor uses generic availability capability; empty and disappearing snapshots are persisted", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PAWPORT_ENABLE_MOCK_SCHEDULING: "true",
  });
  delete process.env.VERCEL_ENV;
  try {
    const adapter = new MockSchedulingAdapter(id);
    adapter.setAvailability({ id, externalSystem: "mock" }, [slot, slot]);
    const snapshots: AvailabilitySlot[][] = [];
    const store = {
      begin: async () => ({
        ...watch,
        id,
        process_token: id,
        system: "mock" as const,
        status: "active" as const,
      }),
      complete: async (_: string, __: string, s: AvailabilitySlot[]) => {
        snapshots.push(s);
        return s.length;
      },
    };
    assert.equal(
      (
        await processAvailabilityWatch(
          id,
          store,
          () => adapter,
          () => now,
        )
      ).newNotifications,
      1,
    );
    adapter.setAvailability({ id, externalSystem: "mock" }, []);
    await processAvailabilityWatch(
      id,
      store,
      () => adapter,
      () => now,
    );
    assert.equal(snapshots[1].length, 0);
    const unsupported = {
      ...adapter,
      system: "mock" as const,
      capabilities: { ...adapter.capabilities, supportsAvailability: false },
      validateConnection: async () => true,
      getConnectionMetadata: async () => ({ label: "unsupported" }),
    };
    let failed = false;
    await processAvailabilityWatch(
      id,
      {
        ...store,
        complete: async (_, __, ___, error) => {
          failed = Boolean(error);
          return 0;
        },
      },
      () => unsupported,
      () => now,
    );
    assert.equal(failed, true);
    Object.assign(process.env, { NODE_ENV: "production" });
    await assert.rejects(
      adapter.listAvailability({ id, externalSystem: "mock" }),
    );
  } finally {
    for (const key of [
      "NODE_ENV",
      "PAWPORT_ENABLE_MOCK_SCHEDULING",
      "VERCEL_ENV",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
