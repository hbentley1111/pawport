import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createPipeline,
  type Rpc,
} from "../supabase/functions/_shared/live-booking/pipeline";
import { createHandler } from "../supabase/functions/_shared/live-booking/handler";
import {
  BookingError,
  type LiveSchedulingAdapter,
} from "../supabase/functions/_shared/live-booking/contract";
const user = randomUUID(),
  quote = randomUUID();
const context = {
  state: "initiated",
  attemptId: randomUUID(),
  credentialRef: "EZYVET_CONNECTION_TEST",
  connectionId: randomUUID(),
  appointmentTypeId: "appointmentType_Test",
  resourceIds: ["resource_Test"],
  resourceId: "resource_Test",
  durationMinutes: 30,
  startsAt: "2026-09-15T13:00:00Z",
  endsAt: "2026-09-15T13:30:00Z",
  timeZone: "America/New_York",
  externalPetId: "animal_Test",
  externalOwnerId: "contact_Test",
};
function setup(mode = "success") {
  const calls: string[] = [];
  let state = "initiated";
  const rpc: Rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    calls.push(name);
    assert.ok(
      args.p_user === user || name === "record_live_connection_validation",
    );
    if (name === "begin_live_booking") return { ...context, state } as T;
    if (name === "complete_live_booking") {
      state = "completed";
      if (mode === "persist_failure") throw new BookingError("unavailable");
      return "local-appointment" as T;
    }
    if (name === "fail_live_booking") {
      state = String(args.p_code);
      return null as T;
    }
    if (name === "store_live_booking_quotes")
      return [
        {
          quoteId: quote,
          startsAt: context.startsAt,
          endsAt: context.endsAt,
          timeZone: context.timeZone,
        },
      ] as T;
    if (name === "prepare_live_availability_context") return context as T;
    return null as T;
  };
  const adapter: LiveSchedulingAdapter = {
    system: "ezyvet",
    capabilities: {
      supportsAvailability: true,
      supportsAppointmentCreate: true,
    },
    getCatalog: async () => ({
      site: { id: "site_Test", timeZone: context.timeZone },
      appointmentTypes: [{ id: context.appointmentTypeId, name: "Wellness" }],
      resources: [{ id: context.resourceId, name: "Resource" }],
    }),
    listAvailability: async () => {
      calls.push("vendor_availability");
      return mode === "gone"
        ? []
        : [
            {
              startsAt: context.startsAt,
              endsAt: context.endsAt,
              timeZone: context.timeZone,
              resourceId: context.resourceId,
              appointmentTypeId: context.appointmentTypeId,
            },
          ];
    },
    validateConnection: async () => {
      throw Error("unused");
    },
    bookAppointment: async () => {
      calls.push("vendor_POST");
      if (mode === "unknown") throw new BookingError("unknown");
      return { externalAppointmentId: "appointment_Test" };
    },
  };
  return {
    calls,
    run: createPipeline(
      rpc,
      async () => adapter,
      () => Date.parse("2026-09-12T12:00Z"),
    ),
  };
}
test("Worker reconfirms exact slot before one POST and persists vendor identity before local completion", async () => {
  const f = setup();
  assert.deepEqual(await f.run(user, { action: "book", quoteId: quote }), {
    state: "completed",
    appointmentId: "local-appointment",
  });
  assert.ok(
    f.calls.indexOf("vendor_availability") < f.calls.indexOf("vendor_POST"),
  );
  assert.ok(
    f.calls.indexOf("reconfirm_live_booking") < f.calls.indexOf("vendor_POST"),
  );
  assert.ok(
    f.calls.indexOf("record_live_vendor_confirmation") <
      f.calls.indexOf("complete_live_booking"),
  );
  await f.run(user, { action: "book", quoteId: quote });
  assert.equal(f.calls.filter((c) => c === "vendor_POST").length, 1);
});
test("Disappearing slot prevents vendor POST", async () => {
  const f = setup("gone");
  await assert.rejects(
    f.run(user, { action: "book", quoteId: quote }),
    /slot_gone/,
  );
  assert.ok(!f.calls.includes("vendor_POST"));
});
test("Ambiguous dispatch and database failure after vendor success are unknown, never retried", async () => {
  for (const mode of ["unknown", "persist_failure"]) {
    const f = setup(mode);
    await assert.rejects(
      f.run(user, { action: "book", quoteId: quote }),
      /unknown/,
    );
    await assert.rejects(f.run(user, { action: "book", quoteId: quote }));
    assert.equal(f.calls.filter((c) => c === "vendor_POST").length, 1);
  }
});
test("Owner availability projection contains only quotes, never privileged context", async () => {
  const f = setup();
  const result = await f.run(user, {
    action: "availability",
    locationId: randomUUID(),
    serviceId: randomUUID(),
    petId: randomUUID(),
  });
  const text = JSON.stringify(result);
  for (const secret of [
    "connectionId",
    "credentialRef",
    "externalPetId",
    "externalOwnerId",
    "resourceId",
    "appointmentTypeId",
    "animal_Test",
  ])
    assert.ok(!text.includes(secret));
});
test("Edge authentication, exact origins, strict actions, no browser user identity", async () => {
  const received: string[] = [];
  const handler = createHandler({
    origins: ["https://sandbox.pawport.test"],
    enabled: () => {},
    authenticate: async (jwt) => {
      assert.equal(jwt, "valid");
      return user;
    },
    run: async (id) => {
      received.push(id);
      return { state: "completed" };
    },
  });
  const request = (
    body: unknown,
    origin = "https://sandbox.pawport.test",
    token = "Bearer valid",
  ) =>
    new Request("https://edge.test", {
      method: "POST",
      headers: { Origin: origin, Authorization: token },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await handler(request({ action: "book", quoteId: quote }))).status,
    200,
  );
  assert.deepEqual(received, [user]);
  assert.equal(
    (
      await handler(
        request({ action: "book", quoteId: quote, user_id: randomUUID() }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handler(
        request({ action: "book", quoteId: quote }, "https://evil.test"),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handler(request({ action: "book", quoteId: quote }, undefined, "")))
      .status,
    401,
  );
  const response = await handler(request({ action: "book", quoteId: quote }));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://sandbox.pawport.test",
  );
});
test("Production-disabled worker never authenticates or reaches the vendor", async () => {
  let called = false;
  const h = createHandler({
    origins: ["https://app.test"],
    enabled: () => {
      throw new BookingError("unavailable");
    },
    authenticate: async () => {
      called = true;
      return user;
    },
    run: async () => {
      called = true;
    },
  });
  assert.equal(
    (
      await h(
        new Request("https://edge.test", {
          method: "POST",
          headers: {
            Origin: "https://app.test",
            Authorization: "Bearer valid",
          },
          body: "{}",
        }),
      )
    ).status,
    409,
  );
  assert.equal(called, false);
});

test("A failed database-only recovery stays unknown and never calls the vendor", async () => {
  let vendor = false;
  const rpc: Rpc = async <T>(name: string): Promise<T> => {
    if (name === "begin_live_booking")
      return { state: "finalize", attemptId: context.attemptId } as T;
    throw new BookingError("unavailable");
  };
  const run = createPipeline(rpc, async () => {
    vendor = true;
    throw new Error("Must not resolve vendor");
  });
  await assert.rejects(
    run(user, { action: "book", quoteId: quote }),
    /unknown/,
  );
  assert.equal(vendor, false);
});
