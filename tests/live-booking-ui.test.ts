import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LiveBookingForm,
  LiveBookingLink,
  LiveSlotPicker,
} from "../components/live-booking/owner";
import { liveError } from "../lib/live-booking/client";
test("Live booking remains hidden before runtime validation; request fallback is explicit", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(
    renderToStaticMarkup(
      React.createElement(LiveBookingLink, { locationId: id }),
    ),
    "",
  );
  const html = renderToStaticMarkup(
    React.createElement(LiveBookingForm, {
      locationId: id,
      pets: [{ id, name: "Jaxson" }],
      fallback: true,
    }),
  );
  assert.match(html, /Production booking is disabled/);
  assert.match(html, /Request appointment instead/);
  assert.match(html, /appointments\/request\?locationId=/);
  assert.match(html, />Pet</);
  assert.match(html, />Service</);
  assert.ok(!html.includes("Book now"));
  const disabled = renderToStaticMarkup(
    React.createElement(LiveBookingForm, {
      locationId: id,
      pets: [],
      fallback: false,
    }),
  );
  assert.ok(!disabled.includes("Request appointment instead"));
});
test("Slot controls have text labels, business timezone and keyboard-native radio controls", () => {
  const q = {
    quoteId: "quote",
    startsAt: "2026-09-15T13:00:00Z",
    endsAt: "2026-09-15T13:30:00Z",
    expiresAt: "2026-09-15T12:59:00Z",
    timeZone: "America/New_York",
  };
  const html = renderToStaticMarkup(
    React.createElement(LiveSlotPicker, {
      quotes: [q],
      selected: q,
      onSelect: () => {},
    }),
  );
  assert.match(html, /9:00 AM/);
  assert.match(html, /America\/New_York/);
  assert.match(html, /type="radio"/);
  assert.match(html, /checked/);
  assert.match(html, /<legend>/);
});
test("Unknown and unmapped copy never implies a confirmed or reserved appointment", () => {
  assert.match(
    liveError(new Error("unknown")),
    /Don't try the same time again/,
  );
  assert.match(liveError(new Error("unknown")), /Contact the provider/);
  assert.match(
    liveError(new Error("invalid_mapping")),
    /isn't available for this pet yet/,
  );
  assert.match(liveError(new Error("slot_gone")), /Refresh available times/);
});
