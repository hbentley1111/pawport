import test from "node:test";
import assert from "node:assert/strict";
import {
  authSchema,
  petSchema,
  vaccinationSchema,
  shareSchema,
  vaccinationStatus,
} from "../lib/validation";
const pet = {
  name: "Milo",
  species: "Dog",
  breed: "Golden Retriever",
  birth_date: "2022-04-12",
  sex: "Male",
  microchip: "",
};
const vaccination = {
  pet_id: "123e4567-e89b-42d3-a456-426614174000",
  name: "Rabies",
  administered_on: "2025-01-01",
  due_on: "2026-01-01",
  clinic: "Oak & Willow",
};
test("signup requires a valid email and a long password", () => {
  assert.equal(
    authSchema.safeParse({ email: "a@b.com", password: "short" }).success,
    false,
  );
  assert.equal(
    authSchema.safeParse({ email: "a@b.com", password: "a-long-passphrase" })
      .success,
    true,
  );
});
test("pet dates must exist and cannot be in the future", () => {
  for (const birth_date of ["2025-02-30", "2099-01-01", "2025-13-01"])
    assert.equal(petSchema.safeParse({ ...pet, birth_date }).success, false);
  assert.equal(petSchema.safeParse({ ...pet, birth_date: "" }).success, true);
});
test("whitespace names and invalid microchips are rejected", () => {
  assert.equal(petSchema.safeParse({ ...pet, name: "   " }).success, false);
  assert.equal(
    petSchema.safeParse({ ...pet, microchip: "<script>" }).success,
    false,
  );
});
test("vaccination chronology is validated", () => {
  assert.equal(vaccinationSchema.safeParse(vaccination).success, true);
  assert.equal(
    vaccinationSchema.safeParse({ ...vaccination, due_on: "2024-12-31" })
      .success,
    false,
  );
  assert.equal(
    vaccinationSchema.safeParse({
      ...vaccination,
      administered_on: "2099-01-01",
    }).success,
    false,
  );
  assert.equal(
    vaccinationSchema.safeParse({ ...vaccination, due_on: "" }).success,
    true,
  );
});
test("share duration is limited and pet IDs are UUIDs", () => {
  for (const hours of ["0", "2", "169", "-1"])
    assert.equal(
      shareSchema.safeParse({ pet_id: vaccination.pet_id, hours }).success,
      false,
    );
  assert.equal(
    shareSchema.safeParse({ pet_id: vaccination.pet_id, hours: "24" }).success,
    true,
  );
});
test("status handles overdue, today, 30-day boundary and unknown due dates", () => {
  assert.equal(vaccinationStatus("2026-09-10", "2026-09-11"), "Overdue");
  assert.equal(vaccinationStatus("2026-09-11", "2026-09-11"), "Due soon");
  assert.equal(vaccinationStatus("2026-10-11", "2026-09-11"), "Due soon");
  assert.equal(vaccinationStatus("2026-10-12", "2026-09-11"), "Recorded");
  assert.equal(vaccinationStatus(null), "No due date");
});
