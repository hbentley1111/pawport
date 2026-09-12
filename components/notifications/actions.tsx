"use client";
import { useActionState, useEffect } from "react";
import { notificationAction } from "@/app/notifications/actions";
export function NotificationAction({
  id,
  action,
  children,
}: {
  id?: string;
  action: "read" | "dismiss" | "all";
  children: React.ReactNode;
}) {
  const [state, submit, pending] = useActionState(notificationAction, {});
  useEffect(() => {
    if (state.success)
      window.dispatchEvent(new Event("pawport:notifications-updated"));
  }, [state]);
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id || ""} />
      <input type="hidden" name="action" value={action} />
      <button className="button secondary" disabled={pending}>
        {pending ? "Saving…" : children}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
