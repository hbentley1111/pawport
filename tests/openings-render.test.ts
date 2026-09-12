import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  OpeningsEmpty,
  WatchOverview,
  MatchOverview,
  OpeningsSummary,
  WatchCallToAction,
} from "../components/openings/presentation";
import { activeAppSection } from "../components/app-navigation-links";
import { watchInput, type WatchSummary } from "../lib/openings/schema";
const w: WatchSummary = {
  id: "watch",
  pet_id: "pet",
  pet_name: "Jaxson",
  appointment_id: "appointment",
  provider_name: "My groomer",
  system: "mock",
  google_place_id: null,
  appointment_type: "grooming",
  earliest_date: "2027-10-01",
  latest_date: "2027-10-19",
  earliest_time: "15:00",
  latest_time: "19:00",
  allowed_weekdays: [1, 2, 3, 4, 5],
  current_appointment_start: "2027-10-20T20:00:00Z",
  time_zone: "America/New_York",
  expires_at: "2027-10-20T20:00:00Z",
  status: "active",
  last_checked_at: null,
  last_match_at: null,
  matches: [],
};
test("watch states, notifications copy, and hidden empty dashboard summary", () => {
  assert.equal(
    renderToStaticMarkup(createElement(OpeningsSummary, { watches: [] })),
    "",
  );
  assert.equal(
    renderToStaticMarkup(
      createElement(OpeningsSummary, { watches: [w], petId: "other" }),
    ),
    "",
  );
  assert.match(
    renderToStaticMarkup(createElement(OpeningsSummary, { watches: [w] })),
    /Smart Openings/,
  );
  for (const [status, label] of [
    ["active", "Watching"],
    ["matched", "Opening found"],
    ["connection_unavailable", "Connection unavailable"],
    ["expired", "Expired"],
    ["paused", "Paused"],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(WatchOverview, { watch: { ...w, status } }),
    );
    assert.ok(html.includes(label));
    assert.match(html, /DEMO AVAILABILITY/);
  }
  assert.match(
    renderToStaticMarkup(createElement(OpeningsEmpty)),
    /Live availability is not connected yet/,
  );
  const match = {
    id: "match",
    starts_at: "2027-10-06T19:30:00Z",
    ends_at: "2027-10-06T20:00:00Z",
    last_seen_at: "2027-10-01T10:00:00Z",
    status: "notified" as const,
  };
  const html = renderToStaticMarkup(
    createElement(MatchOverview, { watch: w, match }),
  );
  assert.match(html, /An earlier opening was found/);
  assert.match(html, /Availability can change quickly/);
  assert.match(html, /Direct booking is not connected/);
  assert.doesNotMatch(html, /Book now|Guaranteed|externalSlotId/);
});
test("CTA is capability-gated; manual editing remains and Openings belongs to Care navigation", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(WatchCallToAction, {
        appointmentId: "id",
        supported: false,
      }),
    ),
    "",
  );
  assert.match(
    renderToStaticMarkup(
      createElement(WatchCallToAction, {
        appointmentId: "id",
        supported: true,
      }),
    ),
    /\/appointments\/id\/watch/,
  );
  assert.equal(activeAppSection("/openings"), "Care");
  assert.equal(activeAppSection("/openings/watch"), "Care");
  const source = readFileSync(
    "app/appointments/[appointmentId]/page.tsx",
    "utf8",
  );
  assert.match(source, /a.source === "external" \? await watchContext/);
  assert.match(source, /a.source === "manual" \? \(/);
  assert.match(source, /<AppointmentForm/);
  assert.match(
    readFileSync("lib/openings/worker.ts", "utf8"),
    /import ["']server-only["']/,
  );
  assert.doesNotMatch(
    readFileSync("lib/openings/processor.ts", "utf8"),
    /ezyvet|gingr|moego|daysmart|createAppointment|cancelAppointment/i,
  );
});
test("watch form normalization bounds dates, days, clock times and rejects spoofed fields", () => {
  const valid = {
    earliest_date: "2027-10-01",
    latest_date: "2027-10-19",
    earliest_time: "15:00",
    latest_time: "19:00",
    allowed_weekdays: [1, 2, 3, 4, 5],
    time_zone: "America/New_York",
  };
  assert.ok(watchInput.safeParse(valid).success);
  for (const patch of [
    { allowed_weekdays: [] },
    { allowed_weekdays: [7] },
    { latest_date: "2027-09-01" },
    { earliest_time: "25:00" },
    { latest_time: "12:00" },
    { time_zone: "Fake/Zone" },
    { household_id: "spoof" },
    { external_slot_id: "fake" },
  ])
    assert.equal(watchInput.safeParse({ ...valid, ...patch }).success, false);
});
