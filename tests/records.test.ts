import test from "node:test";
import assert from "node:assert/strict";
import {
  documentSchema,
  matchesDocumentSignature,
  MAX_DOCUMENT_BYTES,
  trustLabel,
} from "../lib/records";
test("document validation accepts supported extension/MIME pairs and rejects unsafe files", () => {
  for (const [name, type] of [
    ["visit.pdf", "application/pdf"],
    ["visit.JPG", "image/jpeg"],
    ["visit.jpeg", "image/jpeg"],
    ["visit.png", "image/png"],
  ])
    assert.equal(
      documentSchema.safeParse({ name, type, size: 123 }).success,
      true,
    );
  for (const [name, type, size] of [
    ["visit.pdf", "image/png", 100],
    ["visit.svg", "image/svg+xml", 100],
    ["../visit.pdf", "application/pdf", 100],
    ["bad\u0000.pdf", "application/pdf", 100],
    ["visit.pdf", "application/pdf", MAX_DOCUMENT_BYTES + 1],
    ["visit.pdf", "application/pdf", 0],
  ])
    assert.equal(documentSchema.safeParse({ name, type, size }).success, false);
  assert.equal(
    matchesDocumentSignature(
      new TextEncoder().encode("%PDF-1.4"),
      "application/pdf",
    ),
    true,
  );
  assert.equal(
    matchesDocumentSignature(
      new TextEncoder().encode("<script>"),
      "application/pdf",
    ),
    false,
  );
  assert.equal(
    matchesDocumentSignature(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    matchesDocumentSignature(Uint8Array.from([255, 216, 255]), "image/jpeg"),
    true,
  );
  assert.equal(matchesDocumentSignature(new Uint8Array(), "image/jpeg"), false);
});
test("trust display never treats an uploaded document or incomplete attestation as vet verified", () => {
  assert.equal(trustLabel({}), "Owner entered");
  assert.equal(
    trustLabel({ source: "document_supported" }),
    "Document supported",
  );
  assert.equal(
    trustLabel({ verification_status: "provider_verified" }),
    "Owner entered",
  );
  assert.equal(
    trustLabel({
      verification_status: "provider_verified",
      source: "document_supported",
    }),
    "Document supported",
  );
  assert.equal(
    trustLabel({
      verification_status: "provider_verified",
      verified_by: "South End Veterinary Clinic",
      verified_at: "2026-09-11T12:00:00Z",
    }),
    "Vet verified",
  );
});
