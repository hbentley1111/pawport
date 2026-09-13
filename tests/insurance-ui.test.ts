import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import {
  cents,
  renewalLabel,
  claimGroup,
  claimStatuses,
  type PlanSummary,
} from "../lib/insurance/schema";
import {
  CoverageCard,
  MaskedNumber,
  TermHistory,
  InsuranceNotice,
  ClaimList,
} from "../components/insurance/presentation";
test("USD input uses exact cents and rejects negative, fractional cents and unsafe amounts", () => {
  assert.equal(cents("842.01"), 84201);
  assert.equal(cents("0"), 0);
  assert.equal(cents(""), null);
  for (const v of ["-1", "1.001", "1e3", "NaN", "90000000000.01"])
    assert.throws(() => cents(v));
});
test("Renewal labels do not claim coverage expiration", () => {
  assert.equal(renewalLabel(null, "2026-09-12"), "No renewal date recorded");
  assert.equal(
    renewalLabel("2026-09-11", "2026-09-12"),
    "Recorded renewal date has passed",
  );
  assert.equal(renewalLabel("2026-10-01", "2026-09-12"), "Renewal coming up");
});
test("Wellness distinction, accessible masking and escaped owner content", () => {
  const p: PlanSummary = {
    planId: "p",
    petId: "pet",
    carrierName: "<script>private</script>",
    planName: "Wellness",
    coverageKind: "wellness_program",
    coverageLabel: "Wellness plan — not insurance",
    status: "active",
    maskedPolicyNumber: "•••• 4821",
    renewalOn: null,
    provenance: "owner_entered",
    provenanceLabel: "Owner entered",
    openClaimCount: 2,
  };
  const html = renderToStaticMarkup(createElement(CoverageCard, { plan: p }));
  assert.match(html, /Wellness plan — not insurance/);
  assert.match(html, /Member number ending in 4821/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|verified policy|Carrier verified/);
  assert.match(
    renderToStaticMarkup(createElement(MaskedNumber, { value: "••••" })),
    /number hidden/,
  );
});
test("Term history and claim groups describe records without benefit calculation", () => {
  const html = renderToStaticMarkup(createElement(TermHistory, { terms: [] }));
  assert.match(html, /No terms entered/);
  assert.match(
    renderToStaticMarkup(createElement(InsuranceNotice)),
    /insurer and policy documents determine actual coverage/,
  );
  assert.match(
    renderToStaticMarkup(createElement(ClaimList, { claims: [], base: "/x" })),
    /No claims recorded/,
  );
  for (const s of claimStatuses)
    assert.ok(
      ["Needs action", "In progress", "Completed"].includes(claimGroup(s)),
    );
  assert.equal(claimGroup("denied"), "Completed");
  assert.equal(claimGroup("more_information_needed"), "Needs action");
});
test("Private delivery proxy and owner routes expose no object path responses or public shares", async () => {
  const upload = await readFile(
      "app/insurance/documents/upload/route.ts",
      "utf8",
    ),
    delivery = await readFile("app/insurance/documents/[id]/route.ts", "utf8");
  assert.match(upload, /getUser/);
  assert.match(upload, /matchesDocumentSignature/);
  assert.match(delivery, /private, no-store/);
  assert.match(delivery, /attachment;/);
  assert.doesNotMatch(delivery, /createSignedUrl|getPublicUrl|service.role/i);
  const migration = await readFile(
    "supabase/migrations/202609110018_pet_insurance_coverage.sql",
    "utf8",
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.(read_share_pass|my_pet_preventive_care|my_pet_timeline)|insert into public\.(health_documents|vaccinations|provider_memberships|provider_scheduling_permissions|notifications)/,
  );
});
