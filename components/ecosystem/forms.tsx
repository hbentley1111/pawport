"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ecosystemAction } from "@/app/quotes/actions";
import { categories } from "@/lib/costs/schema";
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { id: string; name: string }[];
  required?: boolean;
  max?: number;
  value?: string | number | null;
};
export function EcosystemForm({
  action,
  hidden = {},
  fields = [],
  label,
  warning,
}: {
  action: string;
  hidden?: Record<string, string>;
  fields?: Field[];
  label: string;
  warning?: string;
}) {
  const [r, submit, pending] = useActionState(ecosystemAction, {});
  return (
    <form className="business-form routine-card" action={submit}>
      <input type="hidden" name="action" value={action} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} name={k} type="hidden" value={v} />
      ))}
      {warning && <p>{warning}</p>}
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select
              name={f.name}
              defaultValue={String(f.value ?? f.options[0]?.id ?? "")}
            >
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              name={f.name}
              maxLength={f.max || 1000}
              required={f.required}
              defaultValue={String(f.value || "")}
            />
          ) : (
            <input
              type={f.type || "text"}
              name={f.name}
              maxLength={f.max || 160}
              required={f.required}
              defaultChecked={
                f.type === "checkbox" ? f.value === "on" : undefined
              }
              defaultValue={
                f.type === "checkbox" ? undefined : String(f.value ?? "")
              }
            />
          )}
        </label>
      ))}
      <button
        className="button"
        disabled={pending || (action === "request" && !!r.id)}
      >
        {pending ? "Saving…" : label}
      </button>
      {r.error && <p role="alert">{r.error}</p>}
      {r.success && (
        <p role="status">
          {r.success}{" "}
          {r.id && action === "request" && (
            <Link
              href={
                hidden.pet ? `/pets/${hidden.pet}/quotes/${r.id}` : "/quotes"
              }
            >
              View quote request
            </Link>
          )}
          {r.id && ["planning", "update_planning"].includes(action) && (
            <Link href={`/pets/${hidden.pet}/costs/planning/${r.id}`}>
              View cost planning
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
export function QuotePlanning({
  petId,
  requestId,
  year,
  update = false,
}: {
  petId: string;
  requestId: string;
  year: number;
  update?: boolean;
}) {
  return (
    <EcosystemForm
      action={update ? "update_planning" : "planning"}
      hidden={{ pet: petId, request: requestId }}
      label={update ? "Update planning reference" : "Add to cost planning"}
      warning="Add this quote to your planning. For a price range, Pawport keeps both amounts without choosing a single planned amount."
      fields={[
        {
          name: "year",
          label: "Planning year",
          type: "number",
          required: true,
          value: year,
        },
        {
          name: "category",
          label: "Cost category",
          options: categories.map((c) => ({
            id: c,
            name: c.replaceAll("_", " "),
          })),
        },
        {
          name: "confirm",
          label: "I confirm adding this provider quote to my planning.",
          type: "checkbox",
          required: true,
        },
      ]}
    />
  );
}
export function QuoteSend({ org, request }: { org: string; request: string }) {
  return (
    <EcosystemForm
      action="send"
      hidden={{ org, request }}
      label="Send quote revision"
      warning="A provider-entered estimate is not a guaranteed final price. Use only the amount fields for the chosen type."
      fields={[
        {
          name: "amount_type",
          label: "Amount type",
          options: ["exact", "range", "contact_for_price"].map((id) => ({
            id,
            name: id.replaceAll("_", " "),
          })),
        },
        { name: "amount_cents", label: "Exact amount (USD)" },
        { name: "minimum_amount_cents", label: "Range minimum (USD)" },
        { name: "maximum_amount_cents", label: "Range maximum (USD)" },
        { name: "valid_until", label: "Valid through", type: "date" },
        {
          name: "provider_note",
          label: "Quote notes",
          type: "textarea",
          max: 1000,
        },
      ]}
    />
  );
}
export function ReportResponse({ id }: { id: string }) {
  return (
    <details>
      <summary>Report business response</summary>
      <EcosystemForm
        action="report"
        hidden={{ response: id }}
        label="Submit report"
        fields={[
          {
            name: "reason",
            label: "Reason",
            options: [
              "harassment",
              "privacy",
              "spam",
              "misleading",
              "other",
            ].map((id) => ({ id, name: id })),
          },
          {
            name: "details",
            label: "Details (private to review processing)",
            type: "textarea",
            max: 500,
          },
        ]}
      />
    </details>
  );
}
