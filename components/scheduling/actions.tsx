"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changeConnection, decideMapping } from "@/app/connections/actions";
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button secondary small" disabled={pending}>
      {pending ? "Updating…" : label}
    </button>
  );
}
export function SchedulingAction({
  id,
  status,
  label,
  mapping = false,
}: {
  id: string;
  status: string;
  label: string;
  mapping?: boolean;
}) {
  const [state, action] = useActionState(
    mapping ? decideMapping : changeConnection,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Submit label={label} />
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
