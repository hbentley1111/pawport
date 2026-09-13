"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { insuranceAction } from "@/app/insurance/actions";
import {
  coverageKinds,
  claimStatuses,
  documentTypes,
  renewalLabel,
  type Editable,
  type Document,
} from "@/lib/insurance/schema";
import { useLocalZone, useCareClock } from "@/components/care/local-time";
export function RenewalNote({
  date,
  now,
}: {
  date: string | null;
  now: number;
}) {
  const zone = useLocalZone(),
    clock = useCareClock(now);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(clock);
  return (
    <p>
      {renewalLabel(date, today)}
      {date ? `: ${date}` : ""}. This does not change the status you recorded.
    </p>
  );
}
const fields = {
  plan: [
    "carrier_name",
    "plan_name",
    "policy_number",
    "member_number",
    "started_on",
    "ended_on",
    "renewal_on",
    "customer_service_phone",
    "claims_phone",
    "portal_url",
    "notes",
  ],
  term: [
    "effective_on",
    "ends_on",
    "deductible_amount_cents",
    "reimbursement_percent",
    "annual_limit_cents",
    "coverage_start_on",
    "waiting_period_notes",
    "terms_notes",
  ],
  claim: [
    "title",
    "claim_number",
    "service_date",
    "provider_name",
    "submitted_on",
    "closed_on",
    "amount_submitted_cents",
    "amount_approved_cents",
    "amount_reimbursed_cents",
    "owner_out_of_pocket_cents",
    "insurer_note",
    "owner_note",
  ],
} as const;
export function InsuranceForm({
  mode,
  petId,
  planId = "",
  claimId = "",
  initial = {},
  wellness = false,
}: {
  mode: "plan" | "term" | "claim";
  petId: string;
  planId?: string;
  claimId?: string;
  initial?: Editable;
  wellness?: boolean;
}) {
  const [result, submit, pending] = useActionState(insuranceAction, {}),
    [kind, setKind] = useState(
      String(initial.coverage_kind || "accident_illness"),
    );
  const base = `/pets/${petId}/insurance`;
  return (
    <form
      action={submit}
      className="business-panel business-form"
      autoComplete="off"
    >
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="plan" value={planId} />
      <input type="hidden" name="claim" value={claimId} />
      <input type="hidden" name="action" value={mode} />
      {mode === "plan" && (
        <label>
          Insurance or wellness plan
          <select
            name="coverage_kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {coverageKinds.map((k) => (
              <option key={k} value={k}>
                {k === "wellness_program"
                  ? "Wellness plan — not insurance"
                  : k.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode !== "term" && (
        <label>
          Status you recorded
          <select
            name="status"
            defaultValue={String(
              initial.status || (mode === "claim" ? "draft" : "unknown"),
            )}
          >
            {(mode === "claim"
              ? claimStatuses
              : ["active", "future", "expired", "cancelled", "unknown"]
            ).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {fields[mode].map((key) => {
        const note = key.includes("notes") || key.endsWith("_note"),
          amount = key.endsWith("_cents"),
          date = key.endsWith("_on") || key.endsWith("_date"),
          value = initial[key];
        const label =
          key === "notes"
            ? "Notes for yourself"
            : key === "insurer_note"
              ? "Insurer note you recorded"
              : key === "terms_notes"
                ? "Important plan notes"
                : key === "carrier_name"
                  ? "Insurer or wellness-program name"
                  : key === "policy_number" && kind === "wellness_program"
                    ? "Plan reference (optional)"
                    : key.replaceAll("_cents", " (USD)").replaceAll("_", " ");
        return (
          <label key={key}>
            {label}
            {note ? (
              <textarea
                name={key}
                maxLength={1000}
                rows={3}
                defaultValue={String(value || "")}
              />
            ) : (
              <input
                name={key}
                type={date ? "date" : key === "portal_url" ? "url" : "text"}
                inputMode={
                  amount || key === "reimbursement_percent"
                    ? "decimal"
                    : undefined
                }
                maxLength={
                  amount
                    ? 15
                    : key.includes("number")
                      ? 128
                      : key.includes("phone")
                        ? 40
                        : key === "portal_url"
                          ? 2048
                          : 160
                }
                required={key === "title" || key === "carrier_name"}
                defaultValue={
                  amount && value != null
                    ? (Number(value) / 100).toFixed(2)
                    : String(value ?? "")
                }
              />
            )}
          </label>
        );
      })}
      {mode === "term" && (
        <>
          <label>
            <input type="checkbox" name="annual_limit_unlimited" /> Annual limit
            is unlimited (leave numeric annual limit empty)
          </label>
          <p>
            Enter waiting-period dates only if they appear in your documents or
            were supplied by your insurer. Documents and your insurer determine
            actual exclusions and coverage.
          </p>
          <p>
            Saving creates a new version and preserves previous terms. All
            amounts are owner entered; Pawport calculates no benefits.
          </p>
        </>
      )}
      {mode === "claim" && (
        <p>
          This status is based on information you entered. Pawport does not
          submit or decide claims.
        </p>
      )}
      {mode === "plan" && (kind === "wellness_program" || wellness) && (
        <p>Wellness plan — not insurance.</p>
      )}
      <button className="button" disabled={pending}>
        {pending
          ? "Saving…"
          : mode === "term"
            ? "Save new term version"
            : "Save information"}
      </button>
      {result.error && <p role="alert">{result.error}</p>}
      {result.success && (
        <p role="status">
          {result.success}{" "}
          <Link
            href={
              mode === "claim"
                ? `${base}/${planId}/claims/${result.id || claimId}`
                : mode === "plan"
                  ? `${base}/${result.id || planId}`
                  : `${base}/${planId}`
            }
          >
            View saved information
          </Link>
        </p>
      )}
    </form>
  );
}
export function InsuranceButton({
  petId,
  planId,
  documentId,
  claimId,
  action,
  children,
}: {
  petId: string;
  planId: string;
  documentId: string;
  claimId?: string;
  action: string;
  children: React.ReactNode;
}) {
  const [result, submit, pending] = useActionState(insuranceAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="plan" value={planId} />
      <input type="hidden" name="document" value={documentId} />
      <input type="hidden" name="claim" value={claimId || ""} />
      <input type="hidden" name="action" value={action} />
      <button className="button secondary" disabled={pending}>
        {children}
      </button>
      {result.error && <p role="alert">{result.error}</p>}
      {result.success && <p role="status">{result.success}</p>}
    </form>
  );
}
export function DocumentUpload({
  petId,
  planId,
}: {
  petId: string;
  planId: string;
}) {
  const router = useRouter(),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <form
      className="business-form routine-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        const form = e.currentTarget;
        try {
          const r = await fetch("/insurance/documents/upload", {
            method: "POST",
            body: new FormData(form),
            cache: "no-store",
          });
          const d = await r.json();
          if (!r.ok) throw Error(d.error);
          setMessage("Document attached. Pawport has not verified its terms.");
          form.reset();
          router.refresh();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "Upload unavailable");
        } finally {
          setPending(false);
        }
      }}
    >
      <h3>Add private document</h3>
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="plan" value={planId} />
      <label>
        Document type
        <select name="document_type">
          {documentTypes.map((t) => (
            <option key={t} value={t}>
              {t === "policy"
                ? "Policy / plan document"
                : t.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        PDF, JPEG or PNG · up to 10 MiB
        <input
          type="file"
          name="file"
          accept="application/pdf,image/jpeg,image/png"
          required
        />
      </label>
      <button className="button" disabled={pending}>
        {pending ? "Uploading…" : "Upload document"}
      </button>
      <p>No text extraction or policy interpretation is performed.</p>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function DocumentList({
  documents,
  petId,
  planId,
  claimId,
  linked = [],
}: {
  documents: Document[];
  petId: string;
  planId: string;
  claimId?: string;
  linked?: string[];
}) {
  return (
    <section className="routine-summary">
      <h2>Private documents</h2>
      {!documents.length && <p>No documents attached.</p>}
      {documents.map((d) => (
        <article className="routine-card" key={d.id}>
          <h3>{d.name}</h3>
          <p>
            {d.type === "policy"
              ? "Plan document"
              : d.type.replaceAll("_", " ")}{" "}
            · {d.status}
          </p>
          {d.status === "ready" ? (
            <a className="document-link" href={`/insurance/documents/${d.id}`}>
              Download {d.name}
            </a>
          ) : (
            <InsuranceButton
              petId={petId}
              planId={planId}
              documentId={d.id}
              action="finalize"
            >
              Finish upload
            </InsuranceButton>
          )}
          {claimId && d.status === "ready" && (
            <InsuranceButton
              petId={petId}
              planId={planId}
              documentId={d.id}
              claimId={claimId}
              action={linked.includes(d.id) ? "unlink" : "link"}
            >
              {linked.includes(d.id) ? "Remove from claim" : "Attach to claim"}
            </InsuranceButton>
          )}
          <InsuranceButton
            petId={petId}
            planId={planId}
            documentId={d.id}
            action="retire"
          >
            Retire document
          </InsuranceButton>
        </article>
      ))}
    </section>
  );
}
