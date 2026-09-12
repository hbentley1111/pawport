import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PreventiveSnapshot,
  PreventiveSummaryCard,
  SourceBadge,
} from "../components/preventive-care/presentation";
import {
  itemDate,
  type PreventiveCare,
  type SourceType,
} from "../lib/preventive-care/schema";
const empty: PreventiveCare = {
  pet: { id: "pet", name: "Jaxson", species: "Dog" },
  needsAttention: [],
  upcoming: [],
  routines: [],
  records: [],
  guidance: [],
  savedGuidance: [],
};
test("Empty state makes no health/completeness claim and maintains four distinct groups", () => {
  const html = renderToStaticMarkup(
    React.createElement(PreventiveSnapshot, { data: empty }),
  );
  for (const heading of [
    "Needs attention",
    "Coming up",
    "Your routines",
    "Things to discuss",
  ])
    assert.ok(html.includes(heading));
  assert.match(html, /No record-based items need attention right now/);
  for (const forbidden of [
    "fully protected",
    "up to date",
    "healthy",
    "health score",
  ])
    assert.ok(!html.includes(forbidden));
});
test("Missing/unsupported species keeps factual sections and has no inferred guidance", () => {
  for (const species of [null, "Other"]) {
    const html = renderToStaticMarkup(
      React.createElement(PreventiveSnapshot, {
        data: { ...empty, pet: { ...empty.pet, species } },
      }),
    );
    assert.match(html, /doesn’t yet provide general preventive-care guidance/);
    assert.match(html, /Your routines/);
  }
});
test("Source labels are explicit text and guidance has distinct styling", () => {
  for (const sourceType of [
    "vet_verified",
    "document_supported",
    "owner_entered",
    "care_plan",
    "appointment",
    "pawport_guidance",
  ] as SourceType[]) {
    const html = renderToStaticMarkup(
      React.createElement(SourceBadge, {
        item: { sourceType, sourceLabel: sourceType },
      }),
    );
    assert.ok(html.includes(sourceType));
    assert.equal(
      html.includes("guidance-source"),
      sourceType === "pawport_guidance",
    );
  }
});
test("Pet/global summary links to care without a clinical score", () => {
  const html = renderToStaticMarkup(
    React.createElement(PreventiveSummaryCard, {
      summary: {
        petId: "pet",
        petName: "Jaxson",
        attentionCount: 1,
        upcomingCount: 2,
        guidanceCount: 3,
      },
    }),
  );
  assert.match(html, /1 record needing attention/);
  assert.match(html, /\/pets\/pet\/care/);
  assert.ok(!html.includes("%"));
});
test("Date-only record values do not shift across UTC; timed records respect schedule zone", () => {
  const item = {
    id: "id",
    itemType: "record" as const,
    category: "vaccination",
    title: "Record",
    date: "2026-03-08",
    status: "upcoming",
    sourceType: "owner_entered" as const,
    sourceLabel: "Owner entered",
    trustLevel: "owner" as const,
    actionUrl: "/records",
    explanation: "",
  };
  assert.equal(itemDate(item), "Mar 8, 2026");
  assert.match(
    itemDate({
      ...item,
      date: "2026-03-08T07:00:00Z",
      timeZone: "America/New_York",
    }),
    /3:00 AM/,
  );
});
