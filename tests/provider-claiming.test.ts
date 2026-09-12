import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  claimInput,
  type OwnerClaim,
  type ListingClaimStatus,
} from "../lib/provider-claiming/schema";
import {
  ListingOwnership,
  ClaimCard,
  ClaimGoogleConfirmation,
} from "../components/provider-claiming/presentation";
import {
  createPlacesClient,
  CLAIM_CONFIRMATION_FIELD_MASK,
} from "../lib/services/google-client";
const id = "123e4567-e89b-42d3-a456-426614174001";
const input = {
  placeId: "ChIJ-test",
  requested_organization_id: "",
  organization_name: "My own business name",
  claimant_role: "Owner",
  business_email: "owner@example.com",
  claim_note: "",
};
const claim: OwnerClaim = {
  id,
  googlePlaceId: input.placeId,
  organizationName: input.organization_name,
  status: "pending",
  claimantRole: "Owner",
  createdAt: "2026-09-12T14:00:00Z",
  reviewedAt: null,
  participationActive: false,
};
const unclaimed: ListingClaimStatus = {
  googlePlaceId: input.placeId,
  claimed: false,
  claimable: true,
  organizationId: null,
  organizationName: null,
};
const render = (component: React.ElementType, props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(component, props));
test("bounded claimant-owned input, no spoofed identity, no email verification claim", () => {
  assert.ok(claimInput.safeParse(input).success);
  assert.ok(
    claimInput.safeParse({ ...input, requested_organization_id: id }).success,
  );
  for (const change of [
    { organization_name: " " },
    { organization_name: "x".repeat(161) },
    { claimant_role: "x".repeat(101) },
    { business_email: "invalid" },
    { claim_note: "x".repeat(1501) },
    { placeId: "../../private" },
    { placeId: "x".repeat(256) },
    { requested_by: id },
    { status: "approved" },
    { reviewer_note: "spoof" },
    { requested_organization_id: "foreign-string" },
  ])
    assert.equal(claimInput.safeParse({ ...input, ...change }).success, false);
});
test("unclaimed CTA, claimed business badge and unavailable/suspended states do not imply medical credentials", () => {
  const html = render(ListingOwnership, {
    placeId: input.placeId,
    status: unclaimed,
  });
  assert.match(html, /Own or manage this business/);
  assert.match(html, /Claim this listing/);
  assert.match(html, /\/provider\/claim\?placeId=ChIJ-test/);
  const claimed = render(ListingOwnership, {
    placeId: input.placeId,
    status: { ...unclaimed, claimed: true, claimable: false },
  });
  assert.match(claimed, /Claimed on Pawport/);
  assert.match(claimed, /does not indicate veterinary credential verification/);
  assert.doesNotMatch(
    claimed,
    /Verified business|Vet verified|Claim this listing/,
  );
  assert.match(
    render(ListingOwnership, {
      placeId: input.placeId,
      status: { ...unclaimed, claimable: false },
    }),
    /unavailable for claiming/,
  );
  assert.doesNotMatch(
    render(ListingOwnership, { placeId: input.placeId, status: null }),
    /Claim this listing/,
  );
});
test("claim lifecycle cards use neutral copy and preserve suspension/history without fake profile controls", () => {
  assert.match(render(ClaimCard, { claim }), /Pending review/);
  const approved = render(ClaimCard, {
    claim: { ...claim, status: "approved", participationActive: true },
  });
  assert.match(approved, /Your business profile is ready to manage/);
  assert.match(approved, /href="\/provider\/businesses"/);
  assert.doesNotMatch(approved, /Edit profile|Verify vaccination/);
  assert.match(
    render(ClaimCard, { claim: { ...claim, status: "approved" } }),
    /participation is currently unavailable/,
  );
  assert.match(
    render(ClaimCard, { claim: { ...claim, status: "rejected" } }),
    /couldn’t approve this claim/,
  );
  assert.match(
    render(ClaimCard, { claim: { ...claim, status: "withdrawn" } }),
    /Claim withdrawn/,
  );
  assert.doesNotMatch(
    render(ClaimCard, {
      claim: { ...claim, organizationName: "<script>bad()</script>" },
    }),
    /<script>/,
  );
});
test("Google confirmation requests fixed minimal fields server-side with no-store; its content never pre-fills claim inputs", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        id: input.placeId,
        displayName: { text: "GOOGLE LIVE NAME" },
        formattedAddress: "GOOGLE LIVE ADDRESS",
        googleMapsUri: "https://maps.google.com/?cid=1",
        attributions: [
          { provider: "Data source", providerUri: "https://example.com" },
        ],
      }),
    );
  };
  const place = await createPlacesClient(
    "server-secret-sentinel",
    request,
  ).claimConfirmation(input.placeId);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init?.cache, "no-store");
  assert.equal(
    new Headers(seen[0].init?.headers).get("X-Goog-FieldMask"),
    CLAIM_CONFIRMATION_FIELD_MASK,
  );
  assert.doesNotMatch(
    CLAIM_CONFIRMATION_FIELD_MASK,
    /rating|phone|website|hours|photos|reviews/i,
  );
  const html = render(ClaimGoogleConfirmation, { place });
  assert.match(html, /GOOGLE LIVE NAME/);
  assert.match(html, /GOOGLE LIVE ADDRESS/);
  assert.match(html, /Google Maps/);
  assert.match(html, /Data source/);
  assert.doesNotMatch(html, /server-secret-sentinel/);
  await assert.rejects(
    createPlacesClient(undefined, request).claimConfirmation(input.placeId),
  );
  await assert.rejects(
    createPlacesClient(
      "secret",
      async () => new Response("", { status: 404 }),
    ).claimConfirmation(input.placeId),
  );
  await assert.rejects(
    createPlacesClient(
      "secret",
      async () => new Response("", { status: 429 }),
    ).claimConfirmation(input.placeId),
  );
  const form = readFileSync("components/provider-claiming/forms.tsx", "utf8");
  assert.doesNotMatch(form, /place\.name|place\.address|GOOGLE_MAPS_API_KEY/);
  assert.match(form, /useState\(""\)/);
  assert.match(form, /Create a new organization/);
  assert.match(form, /readOnly/);
});
test("claim routes authenticate without a household, withdrawal requires explicit confirmation, and reviewer has no public endpoint", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const page = read("app/provider/claim/page.tsx");
  assert.match(page, /claimantSession/);
  assert.match(page, /confirmClaimPlace/);
  assert.match(page, /force-dynamic/);
  const actions = read("app/provider/claim/actions.ts");
  assert.match(actions, /form.get\("confirm"\) !== "yes"/);
  assert.match(actions, /claimantSession/);
  assert.match(actions, /confirmClaimPlace/);
  assert.doesNotMatch(actions, /review_service_provider_claim|reviewer_note/);
  const form = read("components/provider-claiming/forms.tsx");
  assert.match(form, /type="checkbox"/);
  assert.match(form, /Confirm withdrawal/);
  assert.match(form, /maxLength=\{254\}/);
  assert.match(form, /autoComplete="email"/);
  assert.match(read("app/provider/page.tsx"), /provider_verification_queue/);
  assert.doesNotMatch(
    read("app/provider/page.tsx"),
    /service_provider_memberships/,
  );
  const migration = read(
    "supabase/migrations/202609110011_provider_claiming.sql",
  );
  assert.match(migration, /nologin noinherit/);
  assert.doesNotMatch(
    migration,
    /insert into public\.(veterinary_providers|provider_memberships|provider_connections|service_reviews)/,
  );
});
