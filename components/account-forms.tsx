"use client";
import { useActionState, useEffect, useRef } from "react";
import { Check, LockKeyhole } from "lucide-react";
import { saveProfile, changePassword } from "@/app/account/actions";
import { Submit } from "@/components/forms";
import type { ActionState } from "@/lib/types";
function Feedback({ state }: { state: ActionState }) {
  return (
    <>
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
    </>
  );
}
export function ProfileForm({
  name,
  phone,
  email,
}: {
  name: string;
  phone: string;
  email: string;
}) {
  const [state, action] = useActionState(saveProfile, {});
  return (
    <form action={action} className="form-stack">
      <label className="field">
        <span>Full name</span>
        <input
          name="full_name"
          autoComplete="name"
          maxLength={100}
          defaultValue={name}
          placeholder="Your name"
        />
      </label>
      <label className="field">
        <span>Contact phone (optional)</span>
        <input
          name="contact_phone"
          type="tel"
          autoComplete="tel"
          maxLength={30}
          defaultValue={phone}
          placeholder="Your phone number"
        />
        <small className="fine-print">
          For your account details only. This does not enable phone sign-in.
        </small>
      </label>
      <label className="field">
        <span>Sign-in email</span>
        <input
          type="email"
          value={email}
          readOnly
          aria-describedby="email-help"
        />
        <small className="fine-print" id="email-help">
          Your verified account email. Email changes aren’t available here yet.
        </small>
      </label>
      <Feedback state={state} />
      <Submit>
        Save account details <Check size={16} />
      </Submit>
    </form>
  );
}
export function PasswordForm() {
  const [state, action] = useActionState(changePassword, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="form-stack">
      <label className="field">
        <span>Current password</span>
        <input
          type="password"
          name="current_password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label className="field">
        <span>New password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          aria-describedby="password-help"
        />
        <small id="password-help" className="fine-print">
          Use at least 12 characters. A long, unique passphrase works well.
        </small>
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <input
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <Feedback state={state} />
      <Submit>
        Change password <LockKeyhole size={16} />
      </Submit>
    </form>
  );
}
