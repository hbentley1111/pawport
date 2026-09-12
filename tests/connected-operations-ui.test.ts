import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectedOperationPanel } from "../components/live-booking/connected-operations";
function panel(
  canCancel = false,
  review = false,
  mutationState: string | null = null,
  pending = false,
) {
  return renderToStaticMarkup(
    React.createElement(ConnectedOperationPanel, {
      state: { canCancel, canReschedule: false, mutationState },
      review,
      pending,
      message: "",
      summary: "Jaxson · Happy Tails · Tuesday 9:30 AM",
      onReview: () => {},
      onCancel: () => {},
      onReconcile: () => {},
      onBack: () => {},
    }),
  );
}
test("Cancellation requires a separate owner confirmation and preserves provider wording", () => {
  assert.match(panel(true), />Cancel appointment</);
  assert.ok(!panel(true).includes("Confirm cancellation"));
  const review = panel(true, true);
  assert.match(review, /Cancel this appointment\?/);
  assert.match(review, /Nothing changes until the provider confirms/);
  assert.match(review, />Confirm cancellation</);
  assert.match(review, />Keep appointment</);
  assert.match(panel(true, true, null, true), /disabled/);
});
test("Unknown confirmation blocks repeated mutations and offers only a status check", () => {
  const html = panel(true, false, "unknown");
  assert.match(html, /Provider confirmation pending/);
  assert.match(html, />Check provider status</);
  assert.ok(!html.includes(">Cancel appointment<"));
  assert.ok(!html.includes(">Reschedule<"));
  assert.ok(!html.includes("Appointment cancelled"));
});
test("Unsupported operations retain contact-provider fallback without a misleading move CTA", () => {
  const html = panel();
  assert.match(html, /Contact the provider to cancel or change/);
  assert.match(html, /Connected rescheduling is unavailable/);
  assert.ok(!html.includes(">Book this opening<"));
  assert.ok(!html.includes(">Reschedule<"));
});
