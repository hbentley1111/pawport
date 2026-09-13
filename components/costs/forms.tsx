"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { costAction } from "@/app/costs/actions";
import {
  categories,
  dollars,
  type Options,
  type Doc,
} from "@/lib/costs/schema";
export function YearPicker({
  year,
  explicit,
}: {
  year: number;
  explicit: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!explicit) {
      const u = new URL(window.location.href);
      u.searchParams.set("year", String(new Date().getFullYear()));
      router.replace(u.pathname + u.search);
    }
  }, [explicit, router]);
  return (
    <form className="business-form">
      <label>
        Year
        <input
          name="year"
          type="number"
          min={2000}
          max={2200}
          defaultValue={year}
        />
      </label>
      <button className="button secondary">View year</button>
    </form>
  );
}
function amountInput(v: unknown) {
  if (v == null) return "";
  const n = BigInt(String(v));
  return `${n / BigInt(100)}.${(n % BigInt(100)).toString().padStart(2, "0")}`;
}
export function CostForm({
  mode,
  petId,
  id = "",
  year,
  initial = {},
  options,
}: {
  mode: "expense" | "planned" | "budget" | "convert" | "allocate";
  petId: string;
  id?: string;
  year: number;
  initial?: Record<string, unknown>;
  options?: Options;
}) {
  const [result, submit, pending] = useActionState(costAction, {});
  const base = `/pets/${petId}/costs`;
  const keys =
    mode === "expense"
      ? [
          "title",
          "category",
          "service_date",
          "provider_name",
          "amount_cents",
          "appointment_id",
          "coverage_plan_id",
          "notes",
        ]
      : mode === "planned"
        ? [
            "title",
            "category",
            "planning_year",
            "planned_amount_cents",
            "due_on",
            "appointment_id",
            "care_plan_id",
            "status",
            "notes",
          ]
        : mode === "budget"
          ? ["category", "amount", "notes"]
          : mode === "convert"
            ? ["amount", "service_date"]
            : ["claim", "amount"];
  return (
    <form
      action={submit}
      className="business-panel business-form"
      autoComplete="off"
    >
      <input type="hidden" name="action" value={mode} />
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="year" value={year} />
      {keys.map((k) => {
        let choices =
          k === "category"
            ? (mode === "budget"
                ? ["all_care", ...categories]
                : categories
              ).map((v) => ({ id: v, title: v.replaceAll("_", " ") }))
            : k === "status"
              ? ["planned", "completed", "cancelled"].map((v) => ({
                  id: v,
                  title: v,
                }))
              : k === "appointment_id"
                ? options?.appointments
                : k === "coverage_plan_id"
                  ? options?.coveragePlans
                  : k === "care_plan_id"
                    ? options?.carePlans
                    : undefined;
        // Keep an existing authorized link even when it falls outside the
        // bounded recent-options page; ordinary edits must not clear it.
        if (
          choices &&
          k.endsWith("_id") &&
          initial[k] &&
          !choices.some((c) => c.id === initial[k])
        ) {
          choices = [
            ...choices,
            {
              id: String(initial[k]),
              title:
                "Current linked " +
                k.replaceAll("_id", "").replaceAll("_", " "),
            },
          ];
        }
        const date = k === "service_date" || k === "due_on";
        const amount = k === "amount" || k.endsWith("_cents");
        const label =
          k === "amount" || k === "amount_cents"
            ? mode === "convert"
              ? "Actual expense amount (USD)"
              : mode === "allocate"
                ? "Reimbursement amount to allocate (USD)"
                : mode === "budget"
                  ? "Budget you entered (USD)"
                  : "Recorded expense amount (USD)"
            : k === "planned_amount_cents"
              ? "Owner-planned amount (USD, optional)"
              : k.replaceAll("_id", "").replaceAll("_", " ");
        if (k === "claim")
          return (
            <input
              key={k}
              name="claim"
              type="hidden"
              value={String(initial.claim || "")}
            />
          );
        return (
          <label key={k}>
            {label}
            {choices ? (
              <select
                name={k}
                defaultValue={String(
                  initial[k] ||
                    (k === "category"
                      ? mode === "budget"
                        ? "all_care"
                        : "veterinary"
                      : k === "status"
                        ? "planned"
                        : ""),
                )}
              >
                {k.endsWith("_id") && <option value="">No link</option>}
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {"date" in c ? ` · ${String(c.date).slice(0, 10)}` : ""}
                  </option>
                ))}
              </select>
            ) : k === "notes" ? (
              <textarea
                name={k}
                maxLength={1000}
                rows={3}
                defaultValue={String(initial[k] || "")}
              />
            ) : (
              <input
                name={k}
                type={date ? "date" : k === "planning_year" ? "number" : "text"}
                inputMode={amount ? "decimal" : undefined}
                min={k === "planning_year" ? 2000 : undefined}
                max={k === "planning_year" ? 2200 : undefined}
                maxLength={amount ? 15 : 160}
                required={[
                  "title",
                  "service_date",
                  "amount",
                  "amount_cents",
                  "planning_year",
                ].includes(k)}
                defaultValue={
                  amount
                    ? amountInput(initial[k])
                    : String(initial[k] ?? (k === "planning_year" ? year : ""))
                }
              />
            )}
          </label>
        );
      })}
      {mode === "convert" && (
        <label>
          <input type="checkbox" name="confirmed" required /> Confirm the amount
          actually paid. This creates one new expense.
        </label>
      )}
      {mode === "budget" && (
        <p>
          These are planning amounts you set. PetThread does not recommend how
          much you should budget.
        </p>
      )}
      {mode === "expense" && (
        <p>
          A coverage-plan link is organizational. It does not mean this expense
          is covered.
        </p>
      )}
      {mode === "planned" && (
        <p>
          Amounts and dates are yours to enter. Completing a planning item does
          not verify medical care.
        </p>
      )}
      <button
        className="button"
        disabled={
          pending ||
          (!!result.id && (mode === "convert" || (!id && mode !== "budget")))
        }
      >
        {pending
          ? "Saving…"
          : mode === "convert"
            ? "Record actual expense"
            : mode === "allocate"
              ? "Save allocation"
              : "Save owner-entered record"}
      </button>
      {result.error && <p role="alert">{result.error}</p>}
      {result.success && (
        <p role="status">
          {result.success}
          {result.id && mode !== "budget" && (
            <Link
              href={`${base}/${mode === "planned" ? "planning" : "expenses"}/${result.id}`}
            >
              {" "}
              View saved record
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
export function CostButton({
  petId,
  id,
  action,
  claim,
  children,
}: {
  petId: string;
  id: string;
  action: "retire" | "finalize" | "unlink";
  claim?: string;
  children: React.ReactNode;
}) {
  const [r, submit, pending] = useActionState(costAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="claim" value={claim || ""} />
      <button className="button secondary" disabled={pending}>
        {children}
      </button>
      {r.error && <p role="alert">{r.error}</p>}
      {r.success && <p role="status">{r.success}</p>}
    </form>
  );
}
export function ExpenseDocuments({
  petId,
  expenseId,
  documents,
}: {
  petId: string;
  expenseId: string;
  documents: Doc[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="routine-summary">
      <h2>Private expense documents</h2>
      {documents.map((d) => (
        <article className="routine-card" key={d.id}>
          <h3>{d.name}</h3>
          <p>
            {d.type} · {d.status} · Amount remains owner entered
          </p>
          {d.status === "ready" ? (
            <a className="document-link" href={`/costs/documents/${d.id}`}>
              Download {d.name}
            </a>
          ) : (
            <CostButton petId={petId} id={d.id} action="finalize">
              Finish upload
            </CostButton>
          )}
          <CostButton petId={petId} id={d.id} action="retire">
            Retire document
          </CostButton>
        </article>
      ))}
      {!documents.length && <p>No documents attached.</p>}
      <form
        className="routine-card business-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending) return;
          setPending(true);
          const form = e.currentTarget;
          try {
            const r = await fetch("/costs/documents/upload", {
              method: "POST",
              body: new FormData(form),
              cache: "no-store",
            });
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            setMessage(
              "Document attached. No amount was extracted or verified.",
            );
            form.reset();
            router.refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Upload unavailable.");
          } finally {
            setPending(false);
          }
        }}
      >
        <input type="hidden" name="pet" value={petId} />
        <input type="hidden" name="expense" value={expenseId} />
        <label>
          Document type
          <select name="document_type">
            {["receipt", "invoice", "estimate", "statement", "other"].map(
              (t) => (
                <option key={t}>{t}</option>
              ),
            )}
          </select>
        </label>
        <label>
          PDF, JPEG or PNG · up to 10 MiB
          <input
            name="file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
          />
        </label>
        <button className="button" disabled={pending}>
          {pending ? "Uploading…" : "Attach private document"}
        </button>
        <p>
          Attaching an estimate does not change the recorded expense amount.
        </p>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
export function BudgetValue({ value }: { value: string }) {
  return <>{dollars(value)}</>;
}
