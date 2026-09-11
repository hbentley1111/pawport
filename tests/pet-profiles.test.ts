import test from "node:test";
import assert from "node:assert/strict";
import {
  editPetSchema,
  photoSchema,
  MAX_PHOTO_BYTES,
  petSummary,
} from "../lib/pets";
import { matchesDocumentSignature } from "../lib/records";
test("profile edits validate existing fields and strip ownership/photo injection", () => {
  const pet = {
    pet_id: "123e4567-e89b-42d3-a456-426614174000",
    name: "Milo",
    species: "Dog",
    breed: "Mixed",
    birth_date: "",
    sex: "Unknown",
    microchip: "",
  };
  const parsed = editPetSchema.parse({
    ...pet,
    household_id: "spoof",
    photo_id: "spoof",
    id: "spoof",
  });
  assert.deepEqual(parsed, pet);
  for (const changed of [
    { pet_id: "bad" },
    { name: " " },
    { birth_date: "2099-01-01" },
    { birth_date: "2025-02-30" },
    { species: "Human" },
    { microchip: "<script>" },
    { sex: "invalid" },
  ])
    assert.equal(
      editPetSchema.safeParse({ ...pet, ...changed }).success,
      false,
    );
});
test("photos accept only matching JPEG/PNG and enforce nonempty 3 MiB size and signatures", () => {
  for (const [name, type] of [
    ["face.JPG", "image/jpeg"],
    ["face.jpeg", "image/jpeg"],
    ["face.png", "image/png"],
  ])
    assert.equal(
      photoSchema.safeParse({ name, type, size: MAX_PHOTO_BYTES }).success,
      true,
    );
  for (const [name, type, size] of [
    ["face.svg", "image/svg+xml", 1],
    ["face.pdf", "application/pdf", 1],
    ["face.png", "image/jpeg", 1],
    ["../face.jpg", "image/jpeg", 1],
    ["face.jpg", "image/jpeg", 0],
    ["face.jpg", "image/jpeg", MAX_PHOTO_BYTES + 1],
  ])
    assert.equal(photoSchema.safeParse({ name, type, size }).success, false);
  assert.equal(
    matchesDocumentSignature(
      new TextEncoder().encode("<script>alert(1)</script>"),
      "image/jpeg",
    ),
    false,
  );
  assert.equal(
    matchesDocumentSignature(Uint8Array.from([255, 216, 255]), "image/jpeg"),
    true,
  );
});
test("pet summary handles empty history, attention and unknown dates without changing records", () => {
  assert.deepEqual(petSummary([]), { attention: 0, next: undefined });
  const rows = [
    { name: "Past due", due_on: "2020-01-01" },
    { name: "Unknown", due_on: null },
    { name: "Later", due_on: "2099-01-01" },
  ];
  assert.equal(petSummary(rows).attention, 1);
  assert.equal(petSummary(rows).next?.name, "Past due");
  assert.equal(rows[1].name, "Unknown");
});
