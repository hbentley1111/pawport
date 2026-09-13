"use client";
import { brandLabel } from "@/lib/brand";

import { useActionState, useState } from "react";
import { partnerAction } from "@/app/operator/partners/actions";
import { createBrowserClient } from "@supabase/ssr";
const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw Error("unavailable");
  return createBrowserClient(url, key);
};
export type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  options?: string[];
  required?: boolean;
  max?: number;
};
export function OperatorForm({
  action,
  hidden = {},
  fields,
  label,
}: {
  action: string;
  hidden?: Record<string, string>;
  fields: Field[];
  label: string;
}) {
  const [state, submit, pending] = useActionState(partnerAction, {});
  return (
    <form className="business-form routine-card" action={submit}>
      <input type="hidden" name="action" value={action} />
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select name={f.name} defaultValue={f.value || f.options[0]}>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {brandLabel(o).replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              name={f.name}
              maxLength={f.max || 2000}
              defaultValue={f.value}
            />
          ) : (
            <input
              name={f.name}
              type={f.type || "text"}
              required={f.required}
              maxLength={f.max || 256}
              defaultValue={f.type === "checkbox" ? undefined : f.value}
            />
          )}
        </label>
      ))}
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
export function ValidateConnection({ connectionId }: { connectionId: string }) {
  const [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <div className="routine-card">
      <button
        className="button secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const { data, error } = await createClient().functions.invoke(
              "partner-operations",
              { body: { action: "validate", connectionId } },
            );
            setMessage(
              error
                ? "Validation unavailable. The protected runtime must be configured."
                : data?.success
                  ? "Validation succeeded. Runtime remains disabled."
                  : `Validation did not succeed: ${["unsupported", "credentials_missing", "invalid_configuration", "unavailable"].includes(data?.error) ? data.error : "unavailable"}. Runtime remains disabled.`,
            );
          } catch {
            setMessage("Validation unavailable.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Validating…" : "Validate connection"}
      </button>
      <p role="status">{message}</p>
      <p>
        Only the protected validation runtime can confirm credential
        configuration. No commercial adapters are registered yet.
      </p>
    </div>
  );
}
