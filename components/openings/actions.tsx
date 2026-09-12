"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { watchAction } from "@/app/openings/actions";
export function OpeningSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="button secondary" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
export function OpeningAction({
  id,
  action,
  label,
}: {
  id: string;
  action: string;
  label: string;
}) {
  const [state, submit] = useActionState(watchAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <OpeningSubmit>{label}</OpeningSubmit>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
