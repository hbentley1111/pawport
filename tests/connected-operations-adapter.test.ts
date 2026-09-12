import test from "node:test";
import assert from "node:assert/strict";
import {
  EzyVetAdapter,
  type HttpTransport,
} from "../supabase/functions/_shared/live-booking/ezyvet";
import { BookingError } from "../supabase/functions/_shared/live-booking/contract";
import { parseCalendarAppointment } from "../supabase/functions/_shared/live-booking/appointment-schema";
const credentials = {
  partner_id: "fixture",
  client_id: "fixture",
  client_secret: "fixture-only",
  grant_type: "client_credentials" as const,
  scope: "read-appointment write-appointment",
  site_uid: "site_Test",
};
const row = {
  id: 42,
  uid: "appointment_Test",
  active: true,
  start_at: 1790000000,
  duration: 1800,
  modified_at: 1789999900,
  animal_uid: "animal_Test",
  contact_uid: "contact_Test",
  type_uid: "appointmentType_Test",
  resources: [{ uid: "resource_Test" }],
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function fake(mode = "success") {
  const calls: { url: URL; init: RequestInit }[] = [];
  const transport: HttpTransport = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    if (u.pathname === "/v1/oauth/access_token")
      return response({
        access_token: "fixture-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (u.pathname === "/v2/appointment")
      return response({
        items: [{ appointment: { id: 42, uid: "appointment_Test" } }],
      });
    if (u.pathname === "/v2.1/calendar/appointments")
      return response({ meta: {}, data: [row] });
    if (init.method === "PATCH") {
      if (mode === "timeout")
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(Error("Timeout after vendor receipt")),
          ),
        );
      if (mode === "malformed")
        return response({ items: [{ appointment: { ...row, active: true } }] });
      if (mode !== "success")
        return response({ private: "never expose" }, Number(mode));
      return response({ items: [{ appointment: { ...row, active: false } }] });
    }
    throw Error("Unexpected vendor endpoint");
  };
  return {
    calls,
    adapter: new EzyVetAdapter(credentials, transport, () => Date.now(), 20),
  };
}
test("Exact current cancellation PATCH uses numeric identity, merge-patch content type and documented cancel/reason fields", async () => {
  const f = fake(),
    appointment = await f.adapter.getAppointment("appointment_Test");
  assert.equal(
    appointment.endsAt,
    new Date((row.start_at + 1800) * 1000).toISOString(),
  );
  const r = await f.adapter.cancelAppointment(appointment);
  assert.equal(r.active, false);
  const patch = f.calls.find((c) => c.init.method === "PATCH")!;
  assert.equal(
    patch.url.href,
    "https://api.trial.ezyvet.com/v2/appointment/42",
  );
  assert.equal(
    new Headers(patch.init.headers).get("Content-Type"),
    "application/merge-patch+json",
  );
  assert.deepEqual(JSON.parse(String(patch.init.body)), {
    cancel: true,
    cancellation_reason_text: "Cancelled through Pawport",
  });
  const lookup = f.calls.find((c) => c.url.pathname === "/v2/appointment")!;
  assert.equal(lookup.url.searchParams.get("uid"), "appointment_Test");
  const calendar = f.calls.find(
    (c) => c.url.pathname === "/v2.1/calendar/appointments",
  )!;
  assert.equal(calendar.url.searchParams.get("filter[id][in]"), "42");
  assert.ok(!calendar.url.searchParams.has("filter[active][eq]"));
});
test("Undocumented rescheduling remains unsupported and sends no mutation", async () => {
  const f = fake();
  assert.equal(f.adapter.capabilities.supportsAppointmentReschedule, false);
  await assert.rejects(f.adapter.rescheduleAppointment(), /unsupported/);
  assert.equal(f.calls.length, 0);
});
test("Cancellation requires configured write-appointment scope without altering OAuth scope", async () => {
  const adapter = new EzyVetAdapter(
    { ...credentials, scope: "read-appointment" },
    async () => {
      throw Error("No call expected");
    },
  );
  assert.equal(adapter.capabilities.supportsAppointmentCancel, false);
  await assert.rejects(
    adapter.cancelAppointment(
      parseCalendarAppointment({ meta: {}, data: [row] }, row.uid, row.id),
    ),
    /unsupported/,
  );
});
test("Ambiguous PATCH timeout, 5xx and non-cancelled success never retry", async () => {
  for (const mode of ["timeout", "503", "malformed"]) {
    const f = fake(mode),
      a = await f.adapter.getAppointment(row.uid);
    await assert.rejects(
      f.adapter.cancelAppointment(a),
      (e: unknown) => e instanceof BookingError && e.code === "unknown",
    );
    assert.equal(f.calls.filter((c) => c.init.method === "PATCH").length, 1);
  }
});
test("Definite cancellation rejections return controlled codes without payloads", async () => {
  for (const [status, code] of [
    ["401", "unauthorized"],
    ["403", "unauthorized"],
    ["429", "rate_limited"],
    ["422", "vendor_error"],
  ]) {
    const f = fake(status),
      a = await f.adapter.getAppointment(row.uid);
    await assert.rejects(
      f.adapter.cancelAppointment(a),
      (e: unknown) => e instanceof BookingError && e.message === code,
    );
    assert.equal(f.calls.filter((c) => c.init.method === "PATCH").length, 1);
  }
});
test("Calendar reconciliation rejects foreign identities, missing records, partial pages and malformed timestamps", () => {
  for (const raw of [
    { meta: {}, data: [] },
    { meta: { nextToken: "more" }, data: [row] },
    { meta: {}, data: [{ ...row, uid: "appointment_Foreign" }] },
    { meta: {}, data: [{ ...row, start_at: "tomorrow" }] },
  ])
    assert.throws(() => parseCalendarAppointment(raw, row.uid, row.id));
  assert.equal(
    parseCalendarAppointment(
      { meta: {}, data: [{ ...row, active: false }] },
      row.uid,
      row.id,
    ).active,
    false,
  );
});
