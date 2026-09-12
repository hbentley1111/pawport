import test from "node:test";
import assert from "node:assert/strict";
import {
  wallTimeToISO,
  wallTimeCandidates,
  localDateTime,
  occurrenceFor,
} from "../lib/care/time";
import {
  normalizeAppointment,
  upcoming,
  reminderState,
  filterCare,
  type Appointment,
} from "../lib/care/schema";
import { appointmentCalendar } from "../lib/care/ics";
const id = "123e4567-e89b-42d3-a456-426614174000";
const input = {
  pet_id: id,
  title: "Wellness",
  appointment_type: "veterinary",
  local_start: "2026-09-22T10:30",
  local_end: "2026-09-22T11:30",
  time_zone: "America/Los_Angeles",
  start_occurrence: "earlier",
  end_occurrence: "earlier",
  status: "scheduled",
  provider_name: "My vet",
  location_text: "Home",
  notes: "Private medical details",
  google_place_id: "",
  reminders: [1440],
};
export const exampleCare: Appointment = {
  id,
  pet_id: id,
  source: "manual",
  title: "Wellness",
  appointment_type: "veterinary",
  starts_at: "2026-09-22T17:30:00.000Z",
  ends_at: "2026-09-22T18:30:00.000Z",
  time_zone: "America/Los_Angeles",
  status: "scheduled",
  provider_name: "My vet",
  location_text: "Home",
  notes: "PRIVATE_MEDICAL_DETAILS",
  google_place_id: "ChIJ-linked",
  updated_at: "2026-09-11T12:00:00.000Z",
  appointment_reminders: [],
};
test("local appointment creation preserves absolute time independently of server timezone", () => {
  const result = normalizeAppointment(input);
  assert.equal(result.data.starts_at, exampleCare.starts_at);
  assert.equal(result.data.ends_at, exampleCare.ends_at);
  assert.equal(
    localDateTime(result.data.starts_at, "Asia/Tokyo"),
    "2026-09-23T02:30",
  );
  assert.equal(
    wallTimeToISO("2026-09-22T10:30", "Asia/Kathmandu"),
    "2026-09-22T04:45:00.000Z",
  );
  assert.throws(
    () => normalizeAppointment({ ...input, local_end: "2026-09-22T10:00" }),
    /after start/,
  );
  assert.throws(() =>
    normalizeAppointment({ ...input, local_start: "2026-02-30T10:30" }),
  );
  assert.throws(() => normalizeAppointment({ ...input, source: "external" }));
  assert.throws(() =>
    normalizeAppointment({ ...input, google_place_id: "x".repeat(256) }),
  );
  assert.throws(() =>
    normalizeAppointment({ ...input, google_place_id: "../../secret" }),
  );
});
test("DST gaps reject nonexistent times and folds expose both explicit occurrences", () => {
  assert.throws(
    () => wallTimeToISO("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.equal(
    wallTimeToISO("2026-11-01T01:30", "America/New_York", "earlier"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    wallTimeToISO("2026-11-01T01:30", "America/New_York", "later"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    occurrenceFor("2026-11-01T06:30:00.000Z", "America/New_York"),
    "later",
  );
  assert.equal(
    wallTimeCandidates("2026-04-05T01:45", "Australia/Lord_Howe").length,
    2,
  );
  assert.throws(
    () => wallTimeToISO("2011-12-30T12:00", "Pacific/Apia"),
    /does not exist/,
  );
  assert.throws(() => wallTimeToISO("2026-09-22T10:00", "Not/AZone"));
});
test("upcoming, past, cancelled, per-pet filtering and in-app reminder state are consistent", () => {
  const start = Date.parse(exampleCare.starts_at),
    reminder = { id, reminder_minutes: 120, dismissed_at: null };
  assert.equal(upcoming(exampleCare, start), true);
  assert.equal(upcoming(exampleCare, start + 1), false);
  assert.equal(
    upcoming({ ...exampleCare, status: "cancelled" }, start - 1),
    false,
  );
  assert.equal(
    reminderState(exampleCare, reminder, start - 3 * 3600000),
    "pending",
  );
  assert.equal(reminderState(exampleCare, reminder, start - 3600000), "due");
  assert.equal(
    reminderState(
      exampleCare,
      { ...reminder, dismissed_at: "2026-01-01" },
      start - 1,
    ),
    "dismissed",
  );
  assert.equal(
    reminderState({ ...exampleCare, status: "completed" }, reminder, start - 1),
    "inactive",
  );
  const cancelled = {
    ...exampleCare,
    id: "cancelled",
    status: "cancelled" as const,
  };
  assert.deepEqual(
    filterCare([exampleCare, cancelled], "past", start - 1).map((a) => a.id),
    ["cancelled"],
  );
  assert.equal(
    filterCare([exampleCare], "upcoming", start - 1, "other-pet").length,
    0,
  );
  assert.equal(
    filterCare([exampleCare], "upcoming", start - 1, id, "grooming").length,
    0,
  );
});
test("ICS is UTC, safely escaped and folded, with private notes and Google data excluded", () => {
  const a = {
    ...exampleCare,
    title: "Wellness, visit; " + "🐾".repeat(40) + "\r\nATTENDEE:intruder",
    provider_name: "My provider",
    location_text: "Home, upstairs",
  };
  const raw = appointmentCalendar(a, "Jasper", "https://pawport.example");
  const ics = raw.replace(/\r\n[ \t]/g, "");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART:20260922T173000Z/);
  assert.match(ics, /DTEND:20260922T183000Z/);
  assert.match(ics, /UID:[a-f0-9]{64}@pawport/);
  assert.match(ics, /CLASS:PRIVATE/);
  assert.match(ics, /LOCATION:Home\\, upstairs/);
  assert.doesNotMatch(
    ics,
    /PRIVATE_MEDICAL_DETAILS|ChIJ-linked|BEGIN:VALARM|\r\nATTENDEE:/,
  );
  assert.ok(ics.includes(`https://pawport.example/appointments/${id}`));
  for (const line of raw.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const cancelledRaw = appointmentCalendar(
    { ...a, status: "cancelled" },
    "Jasper",
    "https://pawport.example",
  );
  const cancelled = cancelledRaw.replace(/\r\n[ \t]/g, "");
  assert.match(cancelled, /STATUS:CANCELLED/);
  assert.equal(
    ics.match(/UID:[^\r]+/)?.[0],
    cancelled.match(/UID:[^\r]+/)?.[0],
  );
  assert.doesNotMatch(
    appointmentCalendar(
      { ...exampleCare, ends_at: null },
      "Pet",
      "https://pawport.example",
    ),
    /DTEND/,
  );
});
