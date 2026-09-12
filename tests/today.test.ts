import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  combineToday,
  type PawportTodayItem,
  type TodayResult,
} from "../lib/today/schema";
import {
  TodayEmpty,
  TodayItemCard,
  TodayQuickActions,
  ThisWeek,
} from "../components/today/presentation";
const pet = {
  id: "123e4567-e89b-42d3-a456-426614174001",
  name: "Jaxson",
  species: "Dog",
  photo_id: null,
};
const item: PawportTodayItem = {
  id: "care:occurrence",
  petId: pet.id,
  petName: pet.name,
  kind: "care_due",
  category: "care",
  urgency: "today",
  title: "Heartworm prevention",
  subtitle: "Owner-entered care routine",
  dueAt: "2026-09-12T14:00:00Z",
  dateOnly: false,
  actionUrl: "/care/plans/plan",
  sourceType: "care",
  trustState: null,
  metadata: { timeZone: "America/New_York" },
};
const base: TodayResult = {
  attention: [],
  comingUp: [],
  recentActivity: [],
  summary: {
    overdueCount: 0,
    dueTodayCount: 0,
    nextSevenDaysCount: 0,
    careThisWeek: 0,
    appointmentsThisWeek: 0,
    activeOpeningMatches: 0,
  },
  hasTrackedData: false,
  unreadNotificationCount: 0,
  zone: "UTC",
};
const render = (component: React.ElementType, props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(component, props));
test("Today prioritizes current care over openings, appointments, verification and record dates without duplicate cards", () => {
  const overdue = { ...item, id: "care:overdue", urgency: "overdue" as const };
  const opening = {
    ...item,
    id: "opening:one",
    category: "opening" as const,
    kind: "opening" as const,
  };
  const ap = {
    ...item,
    id: "appointment:one",
    category: "appointment" as const,
  };
  const verification = {
    ...item,
    id: "verification:one",
    category: "notification" as const,
  };
  const health = {
    ...item,
    id: "vaccination-expiration:one",
    category: "health" as const,
  };
  const r = combineToday(
    {
      ...base,
      attention: [health, ap, verification, item, overdue],
      comingUp: [item],
    },
    { count: 1, items: [opening, opening] },
    2,
    "America/New_York",
  );
  assert.deepEqual(
    r.attention.map((i) => i.id),
    [overdue.id, item.id, opening.id, ap.id, verification.id, health.id],
  );
  assert.equal(r.comingUp.length, 0);
  assert.equal(r.unreadNotificationCount, 2);
  assert.equal(r.summary.activeOpeningMatches, 1);
  assert.equal(r.hasTrackedData, true);
  const bounded = combineToday(
    {
      ...base,
      attention: Array.from({ length: 25 }, (_, i) => ({
        ...item,
        id: `care:${i}`,
      })),
    },
    { count: 0, items: [] },
    0,
    "UTC",
  );
  assert.equal(bounded.attention.length, 10);
});
test("Calm empty states, one/multi-pet quick actions and useful weekly summary", () => {
  assert.match(render(TodayEmpty, { fresh: false }), /All caught up/);
  assert.match(
    render(TodayEmpty, { fresh: false }),
    /Nothing needs your attention today/,
  );
  assert.match(render(TodayEmpty, { fresh: true }), /You&#x27;re all set/);
  const single = render(TodayQuickActions, { pets: [pet] });
  for (const path of [
    "/care/plans/new",
    "/appointments/new",
    `/pets/${pet.id}/records`,
    `/pets/${pet.id}/timeline/new`,
  ])
    assert.ok(single.includes(path));
  const multi = render(TodayQuickActions, {
    pets: [pet, { ...pet, id: "other", name: "Ellie" }],
  });
  assert.match(multi, /href="\/records"/);
  assert.match(multi, /Ellie/);
  assert.match(multi, /<details>/);
  assert.equal(render(ThisWeek, { summary: base.summary }), "");
  assert.match(
    render(ThisWeek, {
      summary: {
        ...base.summary,
        nextSevenDaysCount: 3,
        careThisWeek: 2,
        appointmentsThisWeek: 1,
      },
    }),
    /2 care routines/,
  );
});
test("Cards preserve pet identity, owner-entered language, provenance, volatile openings and safe text", () => {
  const care = render(TodayItemCard, { item, pet, zone: "UTC" });
  assert.match(care, /Jaxson/);
  assert.match(care, /Due today/);
  assert.match(care, /Owner-entered care routine/);
  assert.doesNotMatch(care, /Vet verified|needs.*medication/);
  assert.match(
    render(TodayItemCard, {
      item: { ...item, urgency: "overdue", metadata: { snoozed: true } },
      zone: "UTC",
    }),
    /Snoozed[\s\S]*Overdue/,
  );
  const op = render(TodayItemCard, {
    item: {
      ...item,
      category: "opening",
      subtitle: "Availability can change quickly.",
      metadata: { demo: true },
    },
    zone: "UTC",
  });
  assert.match(op, /Check availability/);
  assert.match(op, /Demo availability/);
  assert.doesNotMatch(op, /Book now|reserved|guaranteed/i);
  for (const trust of ["owner_entered", "document_supported", "vet_verified"]) {
    const html = render(TodayItemCard, {
      item: {
        ...item,
        category: "health",
        trustState: trust,
        title: "Rabies vaccination record expires",
      },
      zone: "UTC",
    });
    assert.match(html, /trust-pill/);
    assert.doesNotMatch(html, /needs a vaccine/);
  }
  const unsafe = render(TodayItemCard, {
    item: { ...item, title: "<script>alert(1)</script>" },
    zone: "UTC",
  });
  assert.doesNotMatch(unsafe, /<script>/);
  assert.match(unsafe, /&lt;script&gt;/);
});
test("Browser-local display handles midnight and both DST transitions; date-only routine respects its own zone", () => {
  const show = (at: string, zone = "America/New_York", dateOnly = false) =>
    render(TodayItemCard, { item: { ...item, dueAt: at, dateOnly }, zone });
  assert.match(show("2026-09-12T02:00:00Z"), /Sep 11/);
  assert.match(show("2026-03-08T06:30:00Z"), /1:30/);
  assert.match(show("2026-03-08T07:30:00Z"), /3:30/);
  assert.match(show("2026-11-01T05:30:00Z"), /1:30/);
  assert.match(show("2026-11-01T06:30:00Z"), /1:30/);
  assert.match(show("2026-09-12T02:00:00Z", "Asia/Tokyo", true), /Sep 11/);
  assert.match(show("2026-09-12T02:00:00Z", "Asia/Tokyo"), /Sep 12/);
});
test("Private entrypoints, browser timezone, independent worker permissions and no public worker endpoint", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const home = read("app/page.tsx");
  assert.match(home, /TodayDashboard/);
  assert.match(home, /provider_memberships/);
  assert.match(home, /onboarding/);
  const api = read("app/api/today/route.ts");
  assert.match(api, /no-store/);
  assert.match(api, /getUser/);
  assert.match(api, /validTimeZone/);
  const dashboard = read("components/today/dashboard.tsx");
  assert.match(dashboard, /resolvedOptions\(\).timeZone/);
  assert.match(dashboard, /TodayCareActions/);
  const worker = read("lib/notifications/worker.ts");
  assert.match(worker, /server-only/);
  assert.match(worker, /Promise.allSettled/);
  assert.match(worker, /transports.care/);
  assert.match(worker, /transports.appointments/);
  const nav = read("components/app-navigation.tsx");
  assert.match(nav, /NotificationBell/);
  const bell = read("components/notifications/bell.tsx");
  assert.match(bell, /9\+/);
  assert.match(bell, /aria-label/);
  const notices = read("app/notifications/page.tsx");
  assert.match(notices, /Unread/);
  assert.match(notices, /encodeTimelineCursor/);
  assert.match(notices, /careContext/);
});
