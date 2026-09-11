import test from "node:test";
import assert from "node:assert/strict";
import {
  completeRecovery,
  recoveryEmailSchema,
  recoveryPasswordSchema,
  recoveryUrl,
} from "../lib/password-recovery";
const input = {
  token: "a".repeat(64),
  password: "a-new-long-password",
  confirm: "a-new-long-password",
};
function mock(valid = true, updateFails = false) {
  const calls: unknown[] = [];
  return {
    calls,
    auth: {
      async verifyOtp(value: unknown) {
        calls.push(value);
        return {
          data: { user: valid ? { id: "recovered-member" } : null },
          error: valid ? null : { message: "secret upstream details" },
        };
      },
      async updateUser(value: unknown) {
        calls.push(value);
        return { error: updateFails ? { message: "upstream policy" } : null };
      },
      async signOut(value: unknown) {
        calls.push(value);
      },
    },
  };
}
test("recovery validates email, matching passwords and trusted redirect origin", () => {
  assert.equal(
    recoveryEmailSchema.parse(" person@example.com "),
    "person@example.com",
  );
  assert.equal(recoveryEmailSchema.safeParse("bad").success, false);
  assert.equal(
    recoveryPasswordSchema.safeParse({ ...input, confirm: "different" })
      .success,
    false,
  );
  assert.equal(
    recoveryPasswordSchema.safeParse({
      ...input,
      password: "short",
      confirm: "short",
    }).success,
    false,
  );
  assert.equal(
    recoveryPasswordSchema.safeParse({ ...input, token: "../bad" }).success,
    false,
  );
  assert.equal(
    recoveryUrl("https://pawport.example/path?next=https://evil.example", true),
    "https://pawport.example/auth/reset-password",
  );
  assert.throws(() => recoveryUrl("http://pawport.example", true));
  assert.throws(() => recoveryUrl("javascript:alert(1)", false));
});
test("only a verified recovery token permits updating the password; isolated session is signed out", async () => {
  const { auth, calls } = mock();
  const result = await completeRecovery(auth, input);
  assert.ok(result.success);
  assert.deepEqual(calls, [
    { token_hash: input.token, type: "recovery" },
    { password: input.password },
    { scope: "local" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(input.password));
});
test("invalid or expired recovery cannot update any account", async () => {
  const { auth, calls } = mock(false);
  const result = await completeRecovery(auth, input);
  assert.match(result.error!, /invalid or expired/);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /upstream/);
});
test("invalid password confirmation does not consume the recovery token", async () => {
  const { auth, calls } = mock();
  const result = await completeRecovery(auth, {
    ...input,
    confirm: "not matching",
  });
  assert.ok(result.error);
  assert.equal(calls.length, 0);
});
test("failed password update clears the recovery session and requests a fresh link", async () => {
  const { auth, calls } = mock(true, true);
  const result = await completeRecovery(auth, input);
  assert.match(result.error!, /Request a new link/);
  assert.deepEqual(calls.at(-1), { scope: "local" });
  assert.doesNotMatch(JSON.stringify(result), /upstream/);
});
