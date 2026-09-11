import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustBadge } from "../components/trust-badge";
test("passport trust badge renders clinic attribution and verified date only with attestation", () => {
  const verified = renderToStaticMarkup(
    createElement(TrustBadge, {
      trust: {
        verification_status: "provider_verified",
        verified_by: "South End Veterinary Clinic",
        verified_at: "2026-09-11T12:00:00Z",
      },
    }),
  );
  assert.match(verified, /Vet verified/);
  assert.match(verified, /South End Veterinary Clinic/);
  assert.match(verified, /Sep 11, 2026/);
  const supported = renderToStaticMarkup(
    createElement(TrustBadge, { trust: { source: "document_supported" } }),
  );
  assert.match(supported, /Document supported/);
  assert.doesNotMatch(supported, /Vet verified|Verified by/);
  const legacy = renderToStaticMarkup(createElement(TrustBadge, { trust: {} }));
  assert.match(legacy, /Owner entered/);
});
