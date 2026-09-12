import test from "node:test";
import assert from "node:assert/strict";
import {
  EzyVetAdapter,
  type HttpTransport,
} from "../supabase/functions/_shared/live-booking/ezyvet";
import {
  resolveEzyVetCredentials,
  assertSandboxRuntime,
} from "../supabase/functions/_shared/live-booking/credentials";
import {
  normalizeAvailability,
  nextSevenDates,
  parseSite,
} from "../supabase/functions/_shared/live-booking/schemas";
import {
  BookingError,
  type AvailabilityQuery,
} from "../supabase/functions/_shared/live-booking/contract";
// Sanitized structural fixtures from the current public ezyVet reference. No vendor calls.
const type = "appointmentType_" + "A".repeat(21),
  resource = "resource_" + "B".repeat(21);
const credentials = {
  partner_id: "fixture",
  client_id: "fixture",
  client_secret: "SECRET_SENTINEL",
  grant_type: "client_credentials" as const,
  scope: "fixture-supplied-scope",
  site_uid: "site_Test",
};
const catalogSite = {
  data: {
    id: "site_Test",
    type: "siteInformation",
    relationships: { timezone: { data: { type: "timezone", id: 1 } } },
    included: [
      { id: 1, type: "timezone", attributes: { name: "America/New_York" } },
    ],
  },
};
const envelope = (kind: string) => ({
  meta: { items_page_total: 1 },
  items: [
    {
      [kind]: {
        uid: kind === "resource" ? resource : type,
        name: "Fixture label",
        active: true,
        access: "On Calendar",
      },
    },
  ],
});
function availability(
  date = "2026-09-15",
  start = "09:00:00.000-04:00",
  ids = [resource],
) {
  return {
    data: ids.map((id) => ({
      id: "resourceAvailability_Test",
      type: "resourceAvailability",
      attributes: {
        date,
        timezone: "America/New_York",
        slots: [
          {
            start,
            duration: 30,
            available: true,
            relationships: {
              appointmentType: {
                data: [{ type: "appointmentType", id: type }],
              },
            },
          },
        ],
      },
      relationships: {
        site: { id: "site_Test", type: "site" },
        resource: { id, type: "resource" },
      },
    })),
  };
}
const query: AvailabilityQuery = {
  appointmentTypeId: type,
  durationMinutes: 30,
  resourceIds: [resource],
  dates: ["2026-09-15"],
  site: { id: "site_Test", timeZone: "America/New_York" },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function fixture(
  override?: (
    url: URL,
    init: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const transport: HttpTransport = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const custom = await override?.(u, init);
    if (custom) return custom;
    if (u.pathname === "/v1/oauth/access_token")
      return json({
        access_token: "PRIVATE_TOKEN",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (u.pathname === "/v3/siteInformation") return json(catalogSite);
    if (u.pathname === "/v2/appointmenttype")
      return json(envelope("appointmenttype"));
    if (u.pathname === "/v2/resource") return json(envelope("resource"));
    if (u.pathname === "/v4/calendar/availability")
      return json(
        availability(
          u.searchParams.getAll("dates[]")[0],
          undefined,
          u.searchParams.getAll("resources[]"),
        ),
      );
    if (u.pathname === "/ezycab/booking")
      return json({
        id: "bookingRequest_Test",
        appointment: "appointment_Test",
      });
    throw new Error("Unexpected endpoint");
  };
  return { calls, transport };
}
test("Credentials resolve only the dedicated allowlist; runtime defaults closed", () => {
  const read: string[] = [];
  assert.throws(() =>
    resolveEzyVetCredentials("SUPABASE_SERVICE_ROLE_KEY", (k) => {
      read.push(k);
      return "";
    }),
  );
  assert.deepEqual(read, []);
  assert.throws(() =>
    resolveEzyVetCredentials("EZYVET_CONNECTION_TEST", () => undefined),
  );
  assert.throws(() =>
    resolveEzyVetCredentials("EZYVET_CONNECTION_TEST", () => "{bad"),
  );
  assert.equal(
    resolveEzyVetCredentials("EZYVET_CONNECTION_TEST", () =>
      JSON.stringify(credentials),
    ).scope,
    credentials.scope,
  );
  for (const env of [
    {},
    {
      PAWPORT_SCHEDULING_ENV: "production",
      PAWPORT_EZYVET_SANDBOX_ENABLED: "true",
    },
  ])
    assert.throws(() =>
      assertSandboxRuntime((k) => (env as Record<string, string>)[k]),
    );
  assert.doesNotThrow(() =>
    assertSandboxRuntime(
      (k) =>
        (
          ({
            PAWPORT_SCHEDULING_ENV: "sandbox",
            PAWPORT_EZYVET_SANDBOX_ENABLED: "true",
          }) as Record<string, string>
        )[k],
    ),
  );
});
test("OAuth contract, catalog normalization, token cache and expiration refresh", async () => {
  let now = Date.parse("2026-09-12T12:00Z");
  const f = fixture(),
    a = new EzyVetAdapter(credentials, f.transport, () => now);
  const c = await a.getCatalog();
  assert.deepEqual(c.site, { id: "site_Test", timeZone: "America/New_York" });
  assert.deepEqual(c.resources, [{ id: resource, name: "Fixture label" }]);
  await a.getCatalog();
  assert.equal(
    f.calls.filter((c) => c.url.pathname.includes("access_token")).length,
    1,
  );
  now += 3600000;
  await a.getCatalog();
  assert.equal(
    f.calls.filter((c) => c.url.pathname.includes("access_token")).length,
    2,
  );
  const auth = f.calls.find((c) => c.url.pathname.includes("access_token"))!;
  assert.deepEqual(JSON.parse(String(auth.init.body)), credentials);
  assert.ok(!JSON.stringify(c).includes("SECRET"));
  assert.throws(() => parseSite({ data: {} }, "site_Test"));
  assert.throws(() => parseSite(catalogSite, "site_Foreign"));
});
test("Malformed OAuth and catalog fail closed; 401 refreshes GET once", async () => {
  const f = fixture((u) =>
    u.pathname.includes("access_token") ? json({ token: "bad" }) : undefined,
  );
  await assert.rejects(
    new EzyVetAdapter(credentials, f.transport).getCatalog(),
    /vendor_error/,
  );
  let seen = false;
  const retry = fixture((u) => {
    if (u.pathname === "/v3/siteInformation" && !seen) {
      seen = true;
      return json({}, 401);
    }
  });
  await new EzyVetAdapter(credentials, retry.transport).getCatalog();
  assert.equal(
    retry.calls.filter((c) => c.url.pathname.includes("access_token")).length,
    2,
  );
  const malformed = fixture((u) =>
    u.pathname === "/v2/resource"
      ? json({ meta: { items_page_total: 2 }, items: [] })
      : undefined,
  );
  await assert.rejects(
    new EzyVetAdapter(credentials, malformed.transport).getCatalog(),
  );
});
test("v4 availability batches five resources, dedupes times and enforces vendor bounds", async () => {
  const f = fixture(),
    a = new EzyVetAdapter(credentials, f.transport),
    ids = Array.from(
      { length: 11 },
      (_, i) => "resource_" + String(i).padStart(21, "0"),
    );
  const slots = await a.listAvailability({ ...query, resourceIds: ids });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].startsAt, "2026-09-15T13:00:00.000Z");
  const calls = f.calls.filter((c) => c.url.pathname.includes("availability"));
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (c) =>
        c.url.pathname === "/v4/calendar/availability" &&
        c.url.searchParams.getAll("resources[]").length <= 5,
    ),
  );
  await assert.rejects(
    a.listAvailability({ ...query, dates: Array(8).fill("2026-09-15") }),
  );
  await assert.rejects(a.listAvailability({ ...query, durationMinutes: 9 }));
  await assert.rejects(a.listAvailability({ ...query, durationMinutes: 361 }));
  await assert.rejects(a.listAvailability({ ...query, durationMinutes: 11 }));
  assert.ok(f.calls.every((c) => c.url.hostname.endsWith(".trial.ezyvet.com")));
});
test("Vendor offset normalization preserves DST folds and rejects nonexistent local times", () => {
  const spring = { ...query, dates: ["2026-03-08"] };
  assert.throws(() =>
    normalizeAvailability(availability("2026-03-08", "02:30:00-05:00"), spring),
  );
  assert.equal(
    normalizeAvailability(
      availability("2026-03-08", "03:30:00-04:00"),
      spring,
    )[0].startsAt,
    "2026-03-08T07:30:00.000Z",
  );
  const fall = { ...query, dates: ["2026-11-01"] };
  const early = normalizeAvailability(
      availability("2026-11-01", "01:30:00-04:00"),
      fall,
    )[0],
    late = normalizeAvailability(
      availability("2026-11-01", "01:30:00-05:00"),
      fall,
    )[0];
  assert.equal(Date.parse(late.startsAt) - Date.parse(early.startsAt), 3600000);
  assert.equal(
    nextSevenDates(Date.parse("2026-03-08T04:00Z"), "America/New_York")[0],
    "2026-03-07",
  );
  assert.equal(
    nextSevenDates(Date.parse("2026-03-08T04:00Z"), "America/New_York").length,
    7,
  );
  const unavailable = availability();
  unavailable.data[0].attributes.slots[0].available = false;
  assert.deepEqual(normalizeAvailability(unavailable, query), []);
  assert.throws(() =>
    normalizeAvailability(availability(), {
      ...query,
      site: { ...query.site, timeZone: "UTC" },
    }),
  );
});
const booking = {
  startsAt: "2026-09-15T13:00:00Z",
  endsAt: "2026-09-15T13:30:00Z",
  timeZone: "America/New_York",
  resourceId: resource,
  appointmentTypeId: type,
  animalId: "animal_Test",
  contactId: "contact_Test",
};
test("Booking uses documented ezyCAB host and fields with no invented idempotency header", async () => {
  const f = fixture(),
    a = new EzyVetAdapter(credentials, f.transport, () =>
      Date.parse("2026-09-12T12:00Z"),
    );
  assert.deepEqual(await a.bookAppointment(booking), {
    externalAppointmentId: "appointment_Test",
  });
  const c = f.calls.find((c) => c.url.pathname === "/ezycab/booking")!;
  assert.equal(c.url.hostname, "apiv2.trial.ezyvet.com");
  assert.deepEqual(JSON.parse(String(c.init.body)), {
    startTime: booking.startsAt,
    type,
    durationMinutes: 30,
    appointmentStatus: "confirmed",
    animal: "animal_Test",
    contact: "contact_Test",
    provider: resource,
  });
  assert.ok(!JSON.stringify(c.init.headers).includes("Idempotency"));
});
test("Ambiguous POST timeout, 5xx and malformed success never retry", async () => {
  for (const mode of ["timeout", "server", "malformed"]) {
    const f = fixture((u, init) => {
      if (u.pathname !== "/ezycab/booking") return;
      if (mode === "server") return json({}, 503);
      if (mode === "malformed") return json({ id: "bookingRequest_Test" });
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new Error("timeout")),
        ),
      );
    });
    const a = new EzyVetAdapter(
      credentials,
      f.transport,
      () => Date.parse("2026-09-12T12:00Z"),
      10,
    );
    await assert.rejects(
      a.bookAppointment(booking),
      (e: unknown) => e instanceof BookingError && e.code === "unknown",
    );
    assert.equal(
      f.calls.filter((c) => c.url.pathname === "/ezycab/booking").length,
      1,
    );
  }
});
test("Definite vendor rejection uses bounded owner-safe codes without payloads", async () => {
  for (const [status, code] of [
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [422, "vendor_error"],
  ] as const) {
    const f = fixture((u) =>
      u.pathname === "/ezycab/booking"
        ? json({ private: "DO_NOT_LEAK" }, status)
        : undefined,
    );
    await assert.rejects(
      new EzyVetAdapter(credentials, f.transport, () =>
        Date.parse("2026-09-12T12:00Z"),
      ).bookAppointment(booking),
      (e: unknown) => e instanceof BookingError && e.message === code,
    );
    assert.equal(
      f.calls.filter((c) => c.url.pathname === "/ezycab/booking").length,
      1,
    );
  }
});
