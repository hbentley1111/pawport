import test from "node:test";
import { activeAppSection } from "../components/app-navigation-links";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  ConnectionOverview,
  ExternalAppointmentNotice,
  NoSchedulingConnections,
} from "../components/scheduling/presentation";
import { CareEntry } from "../components/care/presentation";
import { demoPet } from "../lib/demo";
import type { ConnectionSummary } from "../lib/scheduling/schema";
import type { Appointment } from "../lib/care/schema";
test("connection status, disconnected history and explicit demo/empty labels", () => {
  assert.equal(activeAppSection("/connections"), "Account");
  assert.equal(activeAppSection("/connections/demo"), "Account");
  const c: ConnectionSummary = {
    id: "PRIVATE_CONNECTION_ID",
    connection_type: "grooming",
    system: "mock",
    status: "active",
    last_sync_at: null,
    last_success_at: null,
    last_error_code: null,
    can_manage: false,
  };
  for (const [status, label] of [
    ["active", "Connected"],
    ["pending", "Not connected"],
    ["error", "Needs attention"],
    ["paused", "Sync paused"],
    ["revoked", "Disconnected"],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(ConnectionOverview, { connection: { ...c, status } }),
    );
    assert.ok(html.includes(label));
    assert.match(html, /Demo Scheduling System/);
    assert.doesNotMatch(html, /PRIVATE_CONNECTION_ID|credential/);
  }
  assert.match(
    renderToStaticMarkup(createElement(NoSchedulingConnections)),
    /No scheduling connections yet/,
  );
  const readOnly = renderToStaticMarkup(
    createElement(ExternalAppointmentNotice, { state: "disconnected" }),
  );
  assert.match(readOnly, /Managed by your provider/);
  assert.match(readOnly, /read-only/);
  assert.match(readOnly, /may be out of date/);
});
test("external source badge contains no vendor identifiers; manual details still use editable form", () => {
  const a: Appointment = {
    id: "appointment-id",
    pet_id: demoPet.id,
    source: "external",
    sync_state: "disconnected",
    title: "Annual visit",
    appointment_type: "veterinary",
    starts_at: "2027-10-10T14:00:00Z",
    ends_at: null,
    status: "scheduled",
    time_zone: "UTC",
    provider_name: null,
    location_text: null,
    google_place_id: null,
    updated_at: "2026-09-11T00:00:00Z",
    appointment_reminders: [],
  };
  const html = renderToStaticMarkup(
    createElement(CareEntry, { appointment: a, pet: demoPet, zone: "UTC" }),
  );
  assert.match(html, /Synced from provider/);
  assert.match(html, /Disconnected/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(CareEntry, {
        appointment: { ...a, source: "manual" },
        pet: demoPet,
        zone: "UTC",
      }),
    ),
    /Synced from provider/,
  );
  const source = readFileSync(
    "app/appointments/[appointmentId]/page.tsx",
    "utf8",
  );
  assert.match(source, /a.source === "manual" \? \(/);
  assert.match(source, /<AppointmentForm/);
  assert.match(source, /<ExternalAppointmentNotice/);
});
test("registry and worker transport are server-only; there is no public webhook route or public credential configuration", () => {
  for (const file of ["registry", "worker"])
    assert.match(
      readFileSync(`lib/scheduling/${file}.ts`, "utf8"),
      /import ['"]server-only['"]/,
    );
  assert.doesNotMatch(
    readFileSync("next.config.ts", "utf8"),
    /credential_ref|SCHEDULING|VENDOR/,
  );
  const sql = readFileSync(
    "supabase/migrations/202609110006_scheduling_connections.sql",
    "utf8",
  );
  assert.doesNotMatch(
    sql,
    /grant execute[^;]*import_scheduling_event[^;]*to authenticated/i,
  );
});
