"use client";
import { useActionState, useEffect } from "react";
import { careAction } from "@/app/care/actions";
export function TodayCareActions({ id }: { id: string }) {
  const [state, submit, pending] = useActionState(careAction, {});
  useEffect(() => {
    if (state.success) {
      window.dispatchEvent(new Event("pawport:notifications-updated"));
    }
  }, [state]);
  return (
    <form action={submit} className="today-care-actions">
      <input type="hidden" name="id" value={id} />
      <button
        className="button secondary"
        name="action"
        value="complete"
        disabled={pending}
      >
        Mark complete
      </button>
      <details>
        <summary>Snooze</summary>
        <label className="field">
          <span>Remind me later</span>
          <select name="preset" defaultValue="tomorrow">
            <option value="later">In 2 hours</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="three">In 3 days</option>
            <option value="week">In 1 week</option>
          </select>
        </label>
        <button
          className="button secondary"
          name="action"
          value="snooze"
          disabled={pending}
        >
          Save snooze
        </button>
      </details>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
