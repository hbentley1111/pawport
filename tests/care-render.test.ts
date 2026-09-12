import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  CareEntry,
  CareEmpty,
  CareCalendarEmpty,
} from "../components/care/presentation";
import { CareFormDetails } from "../components/care/form-details";
import { AppNavigationLinks } from "../components/app-navigation-links";
import { demoPet } from "../lib/demo";
import type { Appointment } from "../lib/care/schema";
const a: Appointment = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  pet_id: demoPet.id,
  source: "manual",
  title: "<script>unsafe</script>",
  appointment_type: "grooming",
  starts_at: "2026-09-22T17:30:00Z",
  ends_at: null,
  time_zone: "UTC",
  status: "cancelled",
  provider_name: "My groomer",
  location_text: "Home",
  notes: "PRIVATE_NOTES",
  google_place_id: null,
  updated_at: "2026-09-11T00:00:00Z",
  appointment_reminders: [],
};
test("care entries show pet, type, local date, provider and cancelled status without private notes", () => {
  const html = renderToStaticMarkup(
    createElement(CareEntry, {
      appointment: a,
      pet: demoPet,
      zone: "America/Los_Angeles",
    }),
  );
  for (const value of [
    demoPet.name,
    "Grooming",
    "My groomer",
    "Cancelled",
    "10:30",
    "/appointments/" + a.id,
  ])
    assert.ok(html.includes(value));
  assert.doesNotMatch(html, /<script>|PRIVATE_NOTES/);
  assert.match(html, /&lt;script&gt;/);
});
test("household and pet upcoming-care empty states are specific", () => {
  assert.match(
    renderToStaticMarkup(createElement(CareEmpty)),
    /No upcoming care yet/,
  );
  assert.match(
    renderToStaticMarkup(createElement(CareEmpty, { petName: "Jasper" })),
    /Nothing on the calendar for Jasper/,
  );
});
test("create and edit fields preserve required title, type and status", () => {
  const empty = renderToStaticMarkup(createElement(CareFormDetails));
  const edit = renderToStaticMarkup(
    createElement(CareFormDetails, { appointment: a }),
  );
  assert.match(empty, /<input(?=[^>]*name="title")(?=[^>]*required)/);
  assert.match(empty, /value="scheduled"[^>]*selected/);
  assert.match(edit, /value="cancelled"[^>]*selected/);
  assert.match(edit, /&lt;script&gt;/);
});
test("Care is reachable on desktop and five-item mobile navigation; records remain accessible", () => {
  for (const mobile of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(AppNavigationLinks, {
        pathname: "/appointments/new",
        mobile,
      }),
    );
    assert.match(html, /<a(?=[^>]*href="\/care")(?=[^>]*aria-current="page")/);
    assert.equal((html.match(/<a /g) || []).length, mobile ? 5 : 6);
  }
  assert.match(
    readFileSync("app/appointments/page.tsx", "utf8"),
    /href="\/records"/,
  );
  assert.match(
    readFileSync("app/appointments/page.tsx", "utf8"),
    /query = query.eq\("pet_id", pet\)/,
  );
  assert.match(
    readFileSync("app/appointments/page.tsx", "utf8"),
    /household_id/,
  );
  const source = readFileSync("app/services/[placeId]/page.tsx", "utf8");
  assert.match(source, /appointments\/new\?place=/);
  assert.doesNotMatch(source, /appointments\/new\?[^`]*provider_name=/);
});

test("all-pet calendar empty state includes a direct creation action", () => {
  const html = renderToStaticMarkup(createElement(CareCalendarEmpty));
  assert.match(html, /Your family calendar is clear/);
  assert.match(html, /href="\/appointments\/new"/);
});
