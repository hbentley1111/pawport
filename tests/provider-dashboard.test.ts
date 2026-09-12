import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  inviteInput,
  tokenSchema,
  assignableRoles,
  canChangeMember,
  type DashboardOrganization,
  type TeamMember,
} from "../lib/provider-dashboard/schema";
import { ProviderDashboard } from "../components/provider-dashboard/dashboard";
import {
  LocationCard,
  DashboardSummary,
  BusinessActivity,
} from "../components/provider-dashboard/presentation";
const id = "123e4567-e89b-42d3-a456-426614174001";
const org: DashboardOrganization = {
  id,
  name: "Happy Tails",
  status: "active",
  role: "owner",
  locationScope: "all",
  teamSummary: { activeMembers: 4, pendingInvitations: 1 },
  locations: [
    {
      id,
      displayName: "Main Street",
      profileStatus: "published",
      publicProfileUrl: `/providers/${id}`,
      googlePlaceId: "ChIJ-location",
      scheduling: {
        connected: true,
        status: "active",
        system: "mock",
        availabilitySupported: true,
        lastSuccessfulSyncAt: "2026-09-12T14:00:00Z",
        hasError: false,
      },
    },
  ],
};
const member: TeamMember = {
  membershipId: id,
  displayEmail: "teammate@example.com",
  role: "staff",
  active: true,
  locationScope: "all",
  locations: [],
  isSelf: false,
  joinedAt: "2026-09-12T14:00:00Z",
};
test("invitation validation normalizes email, bounds input and prevents invalid scopes", () => {
  const input = inviteInput.parse({
    email: " TEAM@Example.com ",
    role: "staff",
    scope: "all",
    locations: [],
  });
  assert.equal(input.email, "team@example.com");
  for (const data of [
    { ...input, role: "owner" },
    { ...input, scope: "selected", locations: [] },
    { ...input, role: "admin", scope: "selected", locations: [id] },
    { ...input, scope: "all", locations: [id] },
    { ...input, email: "no-email" },
    { ...input, locations: Array(101).fill(id) },
  ])
    assert.equal(inviteInput.safeParse(data).success, false);
  assert.ok(tokenSchema.safeParse("a".repeat(64)).success);
  for (const value of ["abc", "../", "a".repeat(65)])
    assert.equal(tokenSchema.safeParse(value).success, false);
});
test("UI role hierarchy never offers admin escalation, owner modification or self removal", () => {
  assert.deepEqual(assignableRoles("owner"), [
    "admin",
    "staff",
    "scheduling_manager",
  ]);
  assert.deepEqual(assignableRoles("admin"), ["staff", "scheduling_manager"]);
  assert.deepEqual(assignableRoles("staff"), []);
  assert.ok(canChangeMember("owner", { ...member, role: "admin" }));
  assert.equal(canChangeMember("admin", { ...member, role: "admin" }), false);
  assert.equal(canChangeMember("owner", { ...member, role: "owner" }), false);
  assert.equal(canChangeMember("owner", { ...member, isSelf: true }), false);
});
test("dashboard supports empty, multiple organizations, accessible location switching and role-aware actions", () => {
  const render = (organizations: DashboardOrganization[]) =>
    renderToStaticMarkup(
      React.createElement(ProviderDashboard, { organizations }),
    );
  assert.match(render([]), /accepted team invitations/);
  const html = render([org, { ...org, id: "other", name: "Other business" }]);
  assert.match(html, />Business<select/);
  assert.match(html, /Manage team/);
  assert.match(html, /4 active members/);
  const multi = render([
    {
      ...org,
      locations: [
        ...org.locations,
        {
          ...org.locations[0],
          id: "second",
          displayName: "South End",
          profileStatus: "draft",
          publicProfileUrl: null,
        },
      ],
    },
  ]);
  assert.match(multi, /All accessible locations/);
  assert.match(multi, /South End/);
  const staff = render([
    { ...org, role: "staff", teamSummary: null, locationScope: "selected" },
  ]);
  assert.doesNotMatch(staff, /Manage team|Manage profile/);
  assert.match(staff, /Assigned locations/);
  const suspended = renderToStaticMarkup(
    React.createElement(DashboardSummary, {
      organization: { ...org, status: "suspended" },
    }),
  );
  assert.match(suspended, /suspended/);
  assert.doesNotMatch(suspended, /Manage team/);
});
test("scheduling is capability-only and demo availability is never presented as real booking", () => {
  const html = renderToStaticMarkup(
    React.createElement(LocationCard, {
      organization: org,
      location: org.locations[0],
    }),
  );
  assert.match(html, /Demo capability only/);
  assert.match(html, /Read-only connection status/);
  assert.doesNotMatch(
    html,
    /Book now|Pause sync|credential_ref|external_account_id|pet_id/,
  );
  const none = renderToStaticMarkup(
    React.createElement(LocationCard, {
      organization: org,
      location: {
        ...org.locations[0],
        scheduling: {
          connected: false,
          status: "not_connected",
          system: null,
          availabilitySupported: false,
          lastSuccessfulSyncAt: null,
          hasError: false,
        },
      },
    }),
  );
  assert.match(none, /not connected/);
  assert.match(none, /Not available/);
});
test("business audit normalizes private team events without raw metadata", () => {
  const html = renderToStaticMarkup(
    React.createElement(BusinessActivity, {
      events: [
        {
          id,
          eventType: "invitation_created",
          actorEmail: "owner@example.com",
          targetEmail: "alex@example.com",
          role: "staff",
          scope: "selected",
          createdAt: "2026-09-12T14:00:00Z",
        },
      ],
    }),
  );
  assert.match(html, /invited alex@example.com/);
  assert.doesNotMatch(html, /token_hash|actor_id|metadata/);
});
test("invitation routes protect tokens and authenticate without accepting browser identity or emailing", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const page = read("app/provider/invitations/[token]/page.tsx"),
    actions = read("app/provider/dashboard/actions.ts"),
    proxy = read("proxy.ts");
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(page, /index: false/);
  assert.match(page, /Sign in to accept/);
  assert.doesNotMatch(page, /next=|redirect=.*token|console\./);
  assert.match(proxy, /X-Robots-Tag/);
  assert.match(proxy, /Referrer-Policy/);
  assert.match(actions, /ownerSession/);
  assert.doesNotMatch(
    actions,
    /form.get\("user_id"\)|console\.|sendEmail|service_role/i,
  );
  const sql = read("supabase/migrations/202609110013_provider_dashboard.sql");
  assert.match(sql, /email_confirmed_at is not null/);
  assert.match(sql, /extensions.gen_random_bytes\(32\)/);
  assert.match(sql, /extensions.digest\(token,'sha256'\)/);
  assert.doesNotMatch(
    sql,
    /(?:insert into|update) public\.(?:provider_memberships|provider_scheduling_permissions|provider_connections|health_documents|service_reviews)\b/i,
  );
  const data = read("lib/provider-dashboard/data.ts");
  assert.match(data, /NODE_ENV === "production"/);
  assert.match(data, /availabilitySupported = false/);
});
