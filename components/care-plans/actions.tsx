"use client";
import { useActionState } from "react";
import { careAction } from "@/app/care/actions";
export function CareButton({
  id,
  action,
  children,
}: {
  id: string;
  action: string;
  children: React.ReactNode;
}) {
  const [state, submit, pending] = useActionState(careAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button className="button secondary" disabled={pending}>
        {pending ? "Saving…" : children}
      </button>
      {state.error && (
        <p role="alert" className="feedback">
          {state.error}
        </p>
      )}
      {state.success && (
        <span className="sr-only" role="status">
          {state.success}
        </span>
      )}
    </form>
  );
}
export function CompletionForm({ id }: { id: string }) {
  const [state, submit, pending] = useActionState(careAction, {});
  return (
    <form action={submit} className="routine-action-form">
      <input type="hidden" name="id" value={id} />
      <label className="field">
        <span>Completion or skip note (optional)</span>
        <textarea name="note" maxLength={500} rows={2} />
      </label>
      <div className="care-page-links">
        <button
          className="button"
          name="action"
          value="complete"
          disabled={pending}
        >
          Mark complete
        </button>
        <button
          className="button secondary"
          name="action"
          value="skip"
          disabled={pending}
        >
          Skip this occurrence
        </button>
      </div>
      {state.error && (
        <p role="alert" className="feedback">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
export function SnoozeForm({ id, zone }: { id: string; zone: string }) {
  const [state, submit, pending] = useActionState(careAction, {});
  return (
    <details className="routine-snooze">
      <summary>Snooze</summary>
      <form action={submit} className="routine-action-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="action" value="snooze" />
        <label className="field">
          <span>Remind me later</span>
          <select name="preset" defaultValue="tomorrow">
            <option value="later">In 2 hours</option>
            <option value="tomorrow">Tomorrow at this time</option>
            <option value="three">In 3 days</option>
            <option value="week">In 1 week</option>
            <option value="custom">Custom date and time</option>
          </select>
        </label>
        <label className="field">
          <span>Custom date and time · {zone}</span>
          <input type="datetime-local" name="until" />
        </label>
        <p className="muted">
          Choose a time after the original due time, within 30 days. The
          routine’s schedule stays the same.
        </p>
        <button className="button secondary" disabled={pending}>
          {pending ? "Saving…" : "Save snooze"}
        </button>
        {state.error && (
          <p className="feedback" role="alert">
            {state.error}
          </p>
        )}
        {state.success && <p role="status">{state.success}</p>}
      </form>
    </details>
  );
}
