"use client";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestPasswordReset,
  resetPassword,
} from "@/app/forgot-password/actions";
function Submit({ reset }: { reset: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? "Working…" : reset ? "Reset password" : "Send reset link"}
    </button>
  );
}
export function PasswordRecoveryForm({ token }: { token?: string }) {
  const [state, action] = useActionState(
    token ? resetPassword : requestPasswordReset,
    {},
  );
  return (
    <>
      <form action={action} className="form-stack">
        {!state.success &&
          (token ? (
            <>
              <input type="hidden" name="token" value={token} />
              <label className="field">
                <span>New password</span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  name="confirm"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </label>
          ))}
        {state.error && (
          <p className="feedback error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="feedback success" role="status">
            {state.success}
          </p>
        )}
        {!state.success && <Submit reset={Boolean(token)} />}
      </form>
      <p>
        <Link className="document-link" href="/login?mode=signin">
          Back to sign in
        </Link>
      </p>
      {token && !state.success && (
        <Link className="document-link" href="/forgot-password">
          Request a new reset link
        </Link>
      )}
    </>
  );
}
