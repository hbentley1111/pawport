import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  planInput,
  dueLabel,
  snoozePreset,
  relevantPlans,
  scheduleLabel,
  type CarePlan,
} from "../lib/care-plans/schema";
import {
  CareComingUp,
  CareHubLinks,
  PlanCard,
  RoutineEmpty,
} from "../components/care-plans/presentation";
import {
  AppNavigationLinks,
  activeAppSection,
} from "../components/app-navigation-links";
const plan: CarePlan = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  pet_id: "123e4567-e89b-42d3-a456-426614174001",
  pet_name: "Ellie",
  title: "Nail trim",
  category: "nail_trim",
  instructions: null,
  recurrence_type: "interval",
  interval_value: 3,
  interval_unit: "week",
  time_zone: "America/New_York",
  anchor_local_date: "2026-09-18",
  anchor_local_time: "20:00",
  ends_on: null,
  reminders: [0],
  status: "active",
  source: "owner_entered",
  updated_at: "2026-09-11T00:00:00Z",
  occurrence: {
    id: "123e4567-e89b-42d3-a456-426614174002",
    scheduled_for: "2026-09-19T00:00:00Z",
    snoozed_until: null,
    status: "pending",
  },
};
const html = (component: React.ReactElement) => renderToStaticMarkup(component);
test("care schedule validation rejects invalid dates, unbounded inputs and unsupported recurrence", () => {
  const v = {
    ...plan,
    instructions: "",
    anchor_local_time: "20:00",
    ends_on: "",
  };
  assert.equal(planInput.safeParse(v).success, true);
  for (const change of [
    { time_zone: "bad/zone" },
    { anchor_local_date: "2026-02-30" },
    { anchor_local_time: "24:00" },
    { interval_value: 0 },
    { interval_value: 366 },
    { recurrence_type: "cron" },
    { title: "x".repeat(121) },
    { instructions: "x".repeat(1001) },
    { ends_on: "2025-01-01" },
    { reminders: [23] },
    { reminders: [0, 0, 0, 0, 0, 0] },
    { recurrence_type: "one_time", interval_value: 1 },
  ])
    assert.equal(
      planInput.safeParse({ ...v, ...change }).success,
      false,
      JSON.stringify(change),
    );
});
test("due language is derived in plan timezone including date-only, snoozed and terminal states", () => {
  assert.equal(dueLabel(plan, Date.parse("2026-09-19T01:00Z")), "Overdue");
  assert.equal(dueLabel(plan, Date.parse("2026-09-18T13:00Z")), "Due today");
  assert.equal(dueLabel(plan, Date.parse("2026-09-17T13:00Z")), "Due tomorrow");
  assert.equal(
    dueLabel(plan, Date.parse("2026-09-14T13:00Z")),
    "Due in 4 days",
  );
  assert.equal(dueLabel(plan, Date.parse("2026-09-01T13:00Z")), "Upcoming");
  assert.equal(
    dueLabel(
      { ...plan, anchor_local_time: null },
      Date.parse("2026-09-19T01:00Z"),
    ),
    "Due today",
  );
  assert.equal(dueLabel({ ...plan, status: "paused" }, Date.now()), "Paused");
  assert.equal(
    dueLabel({ ...plan, status: "archived" }, Date.now()),
    "Archived",
  );
  assert.equal(
    dueLabel({ ...plan, occurrence: null }, Date.now()),
    "Schedule finished",
  );
  assert.equal(
    dueLabel(
      {
        ...plan,
        occurrence: { ...plan.occurrence!, snoozed_until: "2026-09-21T00:00Z" },
      },
      Date.parse("2026-09-19T01:00Z"),
    ),
    "Snoozed",
  );
});
test("tomorrow and other snooze presets preserve local clock across DST", () => {
  assert.equal(
    snoozePreset(
      "tomorrow",
      "America/New_York",
      Date.parse("2026-03-07T17:00Z"),
    ),
    "2026-03-08T16:00:00.000Z",
  );
  assert.equal(
    snoozePreset(
      "tomorrow",
      "America/New_York",
      Date.parse("2026-10-31T16:00Z"),
    ),
    "2026-11-01T17:00:00.000Z",
  );
  assert.equal(
    snoozePreset("three", "UTC", Date.parse("2026-09-11T12:00Z")),
    "2026-09-14T12:00:00.000Z",
  );
  assert.equal(
    snoozePreset("week", "UTC", Date.parse("2026-09-11T12:00Z")),
    "2026-09-18T12:00:00.000Z",
  );
  assert.throws(() => snoozePreset("forever", "UTC"));
});
test("pet and household care select relevant pending items; no manufactured engagement", () => {
  const future = {
      ...plan,
      id: "future",
      occurrence: { ...plan.occurrence!, scheduled_for: "2027-01-01T00:00Z" },
    },
    other = { ...plan, id: "other", pet_id: "other" },
    paused = { ...plan, id: "paused", status: "paused" as const };
  assert.deepEqual(
    relevantPlans(
      [future, other, paused, plan],
      Date.parse("2026-09-14T12:00Z"),
      plan.pet_id,
      true,
    ).map((p) => p.id),
    [plan.id],
  );
  const content = html(
    React.createElement(CareComingUp, { plans: [], pets: [], now: Date.now() }),
  );
  assert.match(content, /Nothing coming up this week/);
  assert.match(content, /href="\/care\/plans\/new"/);
  const pet = html(
    React.createElement(CareComingUp, {
      plans: [plan],
      pets: [],
      petId: plan.pet_id,
      now: Date.parse("2026-09-14T12:00Z"),
    }),
  );
  assert.match(pet, /Nail trim/);
  assert.match(pet, /View all care/);
  assert.match(pet, new RegExp(`pet=${plan.pet_id}`));
});
test("care hub, cards, safe text and empty state retain accessible routes and owner-entered distinction", () => {
  const hub = html(
    React.createElement(CareHubLinks, {
      appointments: 2,
      routines: 4,
      watches: 1,
    }),
  );
  for (const link of ["/appointments", "/care/plans", "/openings"])
    assert.ok(hub.includes(`href="${link}"`));
  assert.match(hub, /4 active/);
  const card = html(
    React.createElement(PlanCard, {
      plan: { ...plan, title: "<script>alert(1)</script>" },
      now: Date.parse("2026-09-18T12:00Z"),
    }),
  );
  assert.match(card, /Owner-entered routine/);
  assert.ok(!card.includes("<script>"));
  assert.match(card, /&lt;script&gt;/);
  assert.match(card, /Due today/);
  assert.match(
    html(React.createElement(RoutineEmpty)),
    /Nothing to remember yet/,
  );
  assert.equal(scheduleLabel(plan), "Every 3 weeks");
  for (const mobile of [true, false]) {
    const nav = html(
      React.createElement(AppNavigationLinks, {
        pathname: "/care/plans/new",
        mobile,
      }),
    );
    assert.match(nav, /<a(?=[^>]*href="\/care")(?=[^>]*aria-current="page")/);
  }
  assert.equal(activeAppSection("/appointments/new"), "Care");
  assert.equal(activeAppSection("/openings"), "Care");
});
test("server actions use narrow RPCs; reminder worker not exposed; owner care cannot modify verified records", () => {
  const actions = readFileSync("app/care/actions.ts", "utf8"),
    worker = readFileSync("lib/care-plans/worker.ts", "utf8"),
    form = readFileSync("components/care-plans/form.tsx", "utf8");
  assert.match(actions, /ownerSession/);
  assert.match(actions, /save_care_plan/);
  assert.doesNotMatch(
    actions,
    /\.from\(|process_care_reminders|service_role|GOOGLE_MAPS/,
  );
  assert.match(worker, /import ["']server-only["']/);
  assert.doesNotMatch(worker, /fetch\(|setInterval|setTimeout/);
  for (const name of [
    "pet_id",
    "anchor_local_date",
    "anchor_local_time",
    "time_zone",
    "reminders",
    "title",
    "instructions",
    "interval_value",
    "interval_unit",
  ])
    assert.ok(form.includes(`name="${name}"`));
  assert.match(form, /separate from\s+veterinarian-verified\s+records/);
});

test("household seven-day window uses local dates across DST and snoozed date-only times can be overdue", () => {
  const boundary = {
    ...plan,
    occurrence: { ...plan.occurrence!, scheduled_for: "2026-03-15T12:00:00Z" },
  };
  // March 7 at 23:30 in New York: local seven-day boundary is March 14, not March 15.
  assert.equal(
    relevantPlans(
      [boundary],
      Date.parse("2026-03-08T04:30:00Z"),
      undefined,
      true,
    ).length,
    0,
  );
  assert.equal(
    dueLabel(
      {
        ...plan,
        anchor_local_time: null,
        occurrence: {
          ...plan.occurrence!,
          snoozed_until: "2026-09-20T16:00:00Z",
        },
      },
      Date.parse("2026-09-20T17:00:00Z"),
    ),
    "Overdue",
  );
});
