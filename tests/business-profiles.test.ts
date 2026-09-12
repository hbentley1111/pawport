import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  parseHoursForm,
  organizationInput,
  locationInput,
  serviceInput,
  logoInput,
  logoSignature,
  type PublicProfile,
} from "../lib/business-profiles/schema";
import {
  BusinessProfile,
  FromBusiness,
  BusinessIndex,
} from "../components/business-profiles/presentation";
const profile: PublicProfile = {
  locationId: "123e4567-e89b-42d3-a456-426614174001",
  googlePlaceId: "ChIJ-local",
  businessName: "Paw & Company",
  locationName: "Uptown",
  claimed: true,
  tagline: "Care close to home.",
  description: "<script>Not HTML</script>",
  websiteUrl: "https://provider.example",
  publicPhone: "+1 704 555 0100",
  publicEmail: "public@example.com",
  address: {
    line1: "Provider-entered street",
    line2: null,
    city: "Charlotte",
    region: "NC",
    postalCode: "28202",
    countryCode: "US",
  },
  timeZone: "America/New_York",
  hoursProvided: true,
  hours: [
    {
      day_of_week: 1,
      slot: 1,
      opens_at: "08:00",
      closes_at: "12:00",
      is_24_hours: false,
    },
    {
      day_of_week: 1,
      slot: 2,
      opens_at: "13:00",
      closes_at: "17:00",
      is_24_hours: false,
    },
  ],
  services: [
    {
      id: "service",
      name: "Annual wellness exams",
      category: "veterinary",
      description: "Discuss care with our team.",
      display_order: 0,
    },
  ],
  logoUrl: null,
  sourceLabel: "Business-provided information",
};
test("provider-entered profile validation rejects unsafe URLs, invalid contacts and oversized fields", () => {
  assert.ok(
    organizationInput.safeParse({
      name: "My business",
      website_url: "https://example.com",
    }).success,
  );
  for (const website_url of [
    "javascript:alert(1)",
    "data:image/png,x",
    "file:///tmp/a",
    "https://user:password@example.com",
    "https://example.com\\evil",
  ])
    assert.equal(
      organizationInput.safeParse({ name: "Business", website_url }).success,
      false,
    );
  for (const x of [
    { name: "" },
    { name: "x".repeat(161) },
    { name: "Business", tagline: "x".repeat(161) },
    { name: "Business", description: "x".repeat(3001) },
    { name: "Business", public_email: "not email" },
    { name: "Business", public_phone: "<b>555</b>" },
    { name: "Business", google_name: "Google name" },
  ])
    assert.equal(organizationInput.safeParse(x).success, false);
  assert.ok(
    locationInput.safeParse({
      time_zone: "America/New_York",
      country_code: "US",
    }).success,
  );
  assert.equal(
    locationInput.safeParse({ time_zone: "Mars/Time" }).success,
    false,
  );
  assert.equal(locationInput.safeParse({ country_code: "USA" }).success, false);
  assert.ok(
    serviceInput.safeParse({
      category: "veterinary",
      name: "Exams",
      display_order: 0,
    }).success,
  );
  assert.equal(
    serviceInput.safeParse({
      category: "verifier",
      name: "Exams",
      display_order: 0,
    }).success,
    false,
  );
});
test("logos enforce MIME, extension, size and binary signature including WebP", () => {
  for (const [name, type] of [
    ["logo.jpg", "image/jpeg"],
    ["logo.png", "image/png"],
    ["logo.webp", "image/webp"],
  ])
    assert.ok(logoInput.safeParse({ name, type, size: 1024 }).success);
  for (const x of [
    { name: "logo.svg", type: "image/svg+xml", size: 10 },
    { name: "logo.jpg", type: "image/png", size: 10 },
    { name: "logo.png", type: "image/png", size: 3145729 },
  ])
    assert.equal(logoInput.safeParse(x).success, false);
  assert.ok(
    logoSignature(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  );
  assert.ok(
    logoSignature(new TextEncoder().encode("RIFF1234WEBP"), "image/webp"),
  );
  assert.equal(
    logoSignature(new TextEncoder().encode("<svg>"), "image/png"),
    false,
  );
});
test("public profile safely renders business-owned content, trust labels, contacts, services and hours", () => {
  const html = renderToStaticMarkup(
    React.createElement(BusinessProfile, { profile }),
  );
  for (const label of [
    "Claimed on Pawport",
    "Business-provided information",
    "Annual wellness exams",
    "Closed",
    "08:00",
    "13:00",
    "public@example.com",
    "View Local Services listing",
  ])
    assert.ok(html.includes(label));
  assert.match(html, /does not indicate veterinary credential verification/);
  assert.doesNotMatch(
    html,
    /<script>|Verified Vet|Pawport Certified|Book now|reviewer_note|object_path/,
  );
  const unknown = renderToStaticMarkup(
    React.createElement(BusinessProfile, {
      profile: { ...profile, hoursProvided: false, hours: [], services: [] },
    }),
  );
  assert.match(unknown, /No hours provided/);
  assert.match(unknown, /Services haven/);
  const preview = renderToStaticMarkup(
    React.createElement(BusinessProfile, { profile, preview: true }),
  );
  assert.match(preview, /Private preview/);
});
test("Local Services keeps From the business separate; management has clear empty/read-only/suspended states", () => {
  const html = renderToStaticMarkup(
    React.createElement(FromBusiness, { profile }),
  );
  assert.match(html, /From the business/);
  assert.match(html, /Separate from the Google listing/);
  assert.match(html, /View Pawport profile/);
  assert.match(
    renderToStaticMarkup(React.createElement(BusinessIndex, { items: [] })),
    /starts with a claim/,
  );
  const items = [
    {
      id: "org",
      name: "Business",
      status: "active",
      role: "staff",
      locations: [],
    },
  ];
  assert.match(
    renderToStaticMarkup(React.createElement(BusinessIndex, { items })),
    /Read-only access/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      React.createElement(BusinessIndex, {
        items: [{ ...items[0], status: "suspended" }],
      }),
    ),
    /href="\/provider\/businesses\/org"/,
  );
});
test("management and upload routes enforce authentication and no Google prefill or privileged credentials", () => {
  const files = [
    "app/provider/businesses/actions.ts",
    "app/provider/businesses/logo-upload/route.ts",
    "lib/business-profiles/data.ts",
    "lib/business-profiles/logo.ts",
    "components/business-profiles/forms.tsx",
  ];
  const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(
    source,
    /GOOGLE_MAPS_API_KEY|SERVICE_ROLE|googlePlaces\(|place\.address|place\.name|dangerouslySetInnerHTML/,
  );
  assert.match(source, /ownerSession/);
  assert.match(source, /getUser/);
  assert.match(source, /headers.get\("origin"\)/);
  assert.match(source, /reader.cancel/);
  assert.match(source, /logoSignature/);
  assert.match(source, /no-store/);
  const sql = readFileSync(
    "supabase/migrations/202609110012_business_profiles.sql",
    "utf8",
  );
  assert.doesNotMatch(
    sql,
    /(?:insert into|update) public\.(?:veterinary_providers|provider_memberships|provider_connections|service_reviews|availability_watches)/i,
  );
  assert.match(sql, /role in \('owner','admin'\)/);
  assert.match(sql, /health_document_read_guard/);
});

test("hours form handles disabled fields, explicit closed days and optional second windows", () => {
  const form = new FormData();
  assert.deepEqual(parseHoursForm(form), { provided: false, hours: [] });
  form.set("hours_provided", "yes");
  for (let day = 0; day < 7; day++) form.set(`day_${day}`, "closed");
  assert.deepEqual(parseHoursForm(form), { provided: true, hours: [] });
  form.set("day_1", "open");
  form.set("open_1_1", "09:00");
  form.set("close_1_1", "12:00");
  assert.equal(parseHoursForm(form).hours.length, 1);
  form.set("open_1_2", "13:00");
  form.set("close_1_2", "17:00");
  assert.equal(parseHoursForm(form).hours.length, 2);
  form.set("close_1_2", "11:00");
  assert.throws(() => parseHoursForm(form));
  form.delete("hours_provided");
  assert.deepEqual(parseHoursForm(form), { provided: false, hours: [] });
});
