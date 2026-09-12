import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  journalInput,
  weightKg,
  timelineTrust,
  type PetTimelineEvent,
} from "../lib/timeline/schema";
import {
  TimelineCard,
  TimelineEmpty,
  TimelineList,
  RecentActivity,
} from "../components/timeline/presentation";
import { PetNavigation } from "../components/pet-navigation";
const pet = "123e4567-e89b-42d3-a456-426614174001";
const event: PetTimelineEvent = {
  id: "journal:123e4567-e89b-42d3-a456-426614174000",
  sourceType: "journal",
  sourceId: "123e4567-e89b-42d3-a456-426614174000",
  petId: pet,
  occurredAt: "2020-09-11T12:00:00Z",
  eventType: "journal_note",
  title: "Beach weekend",
  subtitle: "Owner added",
  description: "A day together.",
  trustState: null,
  category: "life",
  actionUrl: `/pets/${pet}/timeline/123e4567-e89b-42d3-a456-426614174000`,
  photoUrl: null,
  metadata: { entryType: "note", timeZone: "America/New_York" },
};
const input = {
  entry_type: "note",
  title: "A moment",
  note: "",
  occurred_at: "2020-09-11T12:00:00Z",
  time_zone: "America/New_York",
  weight_value: null,
  weight_unit: null,
  photo_id: null,
};
const render = (c: React.ReactElement) => renderToStaticMarkup(c);
test("journal validation accepts past moments, original weight units and same validated photo reference shape", () => {
  assert.ok(journalInput.safeParse(input).success);
  for (const unit of ["lb", "kg"])
    assert.ok(
      journalInput.safeParse({
        ...input,
        entry_type: "weight",
        weight_value: 68.2,
        weight_unit: unit,
      }).success,
    );
  assert.ok(
    journalInput.safeParse({ ...input, entry_type: "photo", photo_id: pet })
      .success,
  );
  assert.equal(weightKg(1, "lb"), 0.45359237);
  assert.equal(weightKg(2, "kg"), 2);
});
test("journal bounds reject future/nonfinite dates, invalid units/weights, lengths, empty milestone and unrelated fields", () => {
  for (const change of [
    { occurred_at: "infinity" },
    { occurred_at: "1899-01-01" },
    { occurred_at: new Date(Date.now() + 86400000).toISOString() },
    { time_zone: "No/Zone" },
    { entry_type: "vaccination" },
    { entry_type: "milestone", title: "" },
    { title: "", note: "" },
    { title: "x".repeat(121) },
    { note: "x".repeat(2001) },
    { photo_id: pet },
    { entry_type: "photo" },
    { entry_type: "weight", weight_value: -1, weight_unit: "lb" },
    { entry_type: "weight", weight_value: 0, weight_unit: "kg" },
    { entry_type: "weight", weight_value: 1000, weight_unit: "lb" },
    { entry_type: "weight", weight_value: 454, weight_unit: "kg" },
    { entry_type: "weight", weight_value: 1.0001, weight_unit: "kg" },
  ])
    assert.equal(
      journalInput.safeParse({ ...input, ...change }).success,
      false,
      JSON.stringify(change),
    );
});
test("owner journal rendering is escaped, nonclinical and separate from verified trust", () => {
  const html = render(
    React.createElement(TimelineCard, {
      event: {
        ...event,
        title: "<script>alert(1)</script>",
        eventType: "journal_weight",
        metadata: { weightValue: 68.2, weightUnit: "lb" },
      },
    }),
  );
  assert.match(html, /Owner added/);
  assert.match(html, /68.2 lb/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(
    html,
    /<script>|Vet verified|healthy weight|overweight|underweight|ideal weight/i,
  );
  for (const [state, label] of [
    ["owner_entered", "Owner entered"],
    ["document_supported", "Document supported"],
    ["vet_verified", "Vet verified"],
  ] as const) {
    assert.equal(timelineTrust(state), label);
    assert.ok(
      render(
        React.createElement(TimelineCard, {
          event: { ...event, sourceType: "vaccination", trustState: state },
        }),
      ).includes(label),
    );
  }
});
test("empty state, recent preview maximum, pet navigation and timeline dates", () => {
  const empty = render(React.createElement(TimelineEmpty, { petId: pet }));
  assert.match(empty, /No memories yet/);
  assert.match(empty, /Add a moment/);
  assert.ok(empty.includes(`/pets/${pet}/timeline/new`));
  const events = Array.from({ length: 4 }, (_, i) => ({
    ...event,
    id: `journal:${i}`,
    title: `Moment ${i}`,
  }));
  const preview = render(
    React.createElement(RecentActivity, { events, petId: pet }),
  );
  assert.ok(!preview.includes("Moment 3"));
  assert.match(preview, /View full timeline/);
  const list = render(
    React.createElement(TimelineList, { events, zone: "UTC" }),
  );
  assert.equal((list.match(/timeline-date/g) || []).length, 1);
  const nav = render(
    React.createElement(PetNavigation, { petId: pet, active: "Timeline" }),
  );
  assert.match(
    nav,
    /<a(?=[^>]*href="[^\"]*\/timeline")(?=[^>]*aria-current="page")/,
  );
  assert.match(nav, /Health Records/);
  assert.match(nav, /Share Passport/);
});
test("private photo access, broken-photo fallback, filters, cursor bounds and authoritative source links remain explicit", () => {
  const route = readFileSync(
      "app/pets/[petId]/timeline/[entryId]/photo/route.ts",
      "utf8",
    ),
    page = readFileSync("app/pets/[petId]/timeline/page.tsx", "utf8"),
    photo = readFileSync("components/timeline/photo.tsx", "utf8"),
    data = readFileSync("lib/timeline/data.ts", "utf8");
  for (const token of [
    "private, no-store",
    "auth.getUser",
    "my_pet_journal_entry",
    "matchesDocumentSignature",
    "MAX_PHOTO_BYTES",
  ])
    assert.ok(route.includes(token));
  assert.doesNotMatch(route, /getPublicUrl|service_role/);
  assert.match(photo, /photo is unavailable/);
  assert.match(page, /Load more/);
  assert.match(page, /timelineFilters/);
  assert.match(data, /512/);
  assert.match(data, /my_pet_timeline/);
  assert.doesNotMatch(data, /db\.from\(/);
});

test("journal cards cannot acquire medical trust badges even from a malformed event", () => {
  const html = render(
    React.createElement(TimelineCard, {
      event: { ...event, trustState: "vet_verified" },
    }),
  );
  assert.doesNotMatch(html, /Vet verified/);
  assert.match(html, /Owner added/);
});
