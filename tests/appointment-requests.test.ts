import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  requestInput,
  normalizeWindows,
  requestLabel,
  type RequestItem,
} from "../lib/appointment-requests/schema";
import {
  RequestCTA,
  RequestDetails,
  RequestList,
} from "../components/appointment-requests/presentation";
const id = "123e4567-e89b-42d3-a456-426614174000";
const request: RequestItem = {
  requestId: id,
  petName: "Jaxson",
  businessName: "Paw & Company",
  locationName: "Main Street",
  serviceName: "Wellness visit",
  timeZone: "America/New_York",
  status: "requested",
  preferredWindows: [
    { startsAt: "2026-10-06T13:00:00Z", endsAt: "2026-10-06T16:00:00Z" },
  ],
  proposal: null,
  responseNote: null,
  createdAt: "2026-09-12T14:00:00Z",
  expiresAt: "2026-09-19T14:00:00Z",
  history: [],
};
test("Request windows use business time, reject DST gaps and consistently choose the first overlap", () => {
  assert.deepEqual(
    normalizeWindows(
      [{ start: "2026-10-06T09:00", end: "2026-10-06T12:00" }],
      "America/New_York",
    ),
    [
      {
        starts_at: "2026-10-06T13:00:00.000Z",
        ends_at: "2026-10-06T16:00:00.000Z",
      },
    ],
  );
  assert.throws(
    () =>
      normalizeWindows(
        [{ start: "2027-03-14T02:30", end: "2027-03-14T03:30" }],
        "America/New_York",
      ),
    /does not exist/,
  );
  assert.equal(
    normalizeWindows(
      [{ start: "2026-11-01T01:30", end: "2026-11-01T02:30" }],
      "America/New_York",
    )[0].starts_at,
    "2026-11-01T05:30:00.000Z",
  );
  assert.throws(() =>
    normalizeWindows(
      [{ start: "2026-10-06T09:00", end: "2026-10-06T12:00" }],
      "Invented/Zone",
    ),
  );
});
test("Request input is bounded and rejects email spoof fields", () => {
  const input = {
    pet: id,
    location: id,
    service: id,
    contactName: "Owner",
    phone: "",
    note: "",
    windows: [{ start: "2026-10-06T09:00", end: "2026-10-06T12:00" }],
  };
  assert.ok(requestInput.safeParse(input).success);
  for (const invalid of [
    { ...input, email: "spoof@example.com" },
    { ...input, note: "a".repeat(1001) },
    { ...input, windows: Array(4).fill(input.windows[0]) },
    { ...input, windows: [] },
    { ...input, contactName: "" },
  ])
    assert.equal(requestInput.safeParse(invalid).success, false);
});
test("Public CTA describes a request rather than live availability", () => {
  const html = renderToStaticMarkup(
    React.createElement(RequestCTA, { location: id }),
  );
  assert.match(html, /Request appointment/);
  assert.match(html, /Nothing is booked until/);
  assert.match(html, /appointments\/request\?locationId=/);
  assert.doesNotMatch(html, /Book now|Instant booking|Guaranteed/);
});
test("Owner list, empty state and request history render safely", () => {
  assert.match(
    renderToStaticMarkup(
      React.createElement(RequestList, {
        items: [],
        base: "/appointments/requests",
      }),
    ),
    /No appointment requests yet/,
  );
  const html = renderToStaticMarkup(
    React.createElement(RequestDetails, {
      item: {
        ...request,
        responseNote: "<script>unsafe()</script>",
        status: "cancelled_by_provider",
      },
    }),
  );
  assert.match(html, /Cancelled by business/);
  assert.match(html, /Jaxson/);
  assert.match(html, /America\/New_York/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(requestLabel("provider_proposed"), "Time proposal to review");
});
test("Client actions fetch trusted business timezone and never accept contact email", () => {
  const actions = readFileSync("app/appointments/request/actions.ts", "utf8");
  assert.match(actions, /service_provider_request_intake/);
  assert.match(actions, /service_provider_appointment_request/);
  assert.doesNotMatch(
    actions,
    /form.get\(["'](?:email|owner_id|household_id|time_zone)["']\)/,
  );
  const forms = readFileSync(
    "components/appointment-requests/forms.tsx",
    "utf8",
  );
  assert.match(forms, /read-only|Read-only/);
  assert.match(forms, /canRespond/);
  assert.match(forms, /consent/);
});
