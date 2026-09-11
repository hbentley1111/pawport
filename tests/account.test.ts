import test from "node:test";
import assert from "node:assert/strict";
import { accountProfile, profileSchema, passwordSchema } from "../lib/account";
test("profile accepts optional details and strips unapproved metadata", () => {
  assert.deepEqual(
    profileSchema.parse({
      full_name: "  Alex Miller  ",
      contact_phone: "+1 (555) 123-4567",
      role: "admin",
      id: "other-user",
    }),
    { full_name: "Alex Miller", contact_phone: "+1 (555) 123-4567" },
  );
  assert.equal(
    profileSchema.safeParse({ full_name: "", contact_phone: "" }).success,
    true,
  );
  for (const contact_phone of ["<script>", "abc", "---", "1".repeat(31)])
    assert.equal(
      profileSchema.safeParse({ full_name: "Alex", contact_phone }).success,
      false,
    );
  assert.equal(
    profileSchema.safeParse({ full_name: "a".repeat(101), contact_phone: "" })
      .success,
    false,
  );
});
test("display profile handles malformed user metadata without trusting roles", () => {
  assert.deepEqual(
    accountProfile({
      full_name: { role: "admin" },
      contact_phone: 123,
      role: "owner",
    }),
    { full_name: "", contact_phone: "" },
  );
  assert.equal(
    accountProfile({ full_name: "a".repeat(500) }).full_name.length,
    100,
  );
});
test("password changes require the current password, matching confirmation, and a different strong password", () => {
  const valid = {
    current_password: "old-password-123",
    password: "new-password-456",
    confirm_password: "new-password-456",
  };
  assert.equal(passwordSchema.safeParse(valid).success, true);
  for (const edit of [
    { current_password: "" },
    { confirm_password: "does-not-match" },
    { password: "short", confirm_password: "short" },
    {
      password: valid.current_password,
      confirm_password: valid.current_password,
    },
  ])
    assert.equal(
      passwordSchema.safeParse({ ...valid, ...edit }).success,
      false,
    );
});
