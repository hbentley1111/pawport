"use client";
import { useActionState, useState } from "react";
import { submitClaim, withdrawClaim } from "@/app/provider/claim/actions";
import {
  claimingTrustCopy,
  type BusinessOrganization,
} from "@/lib/provider-claiming/schema";
export function ClaimForm({
  placeId,
  organizations,
}: {
  placeId: string;
  organizations: BusinessOrganization[];
}) {
  const [state, submit, pending] = useActionState(submitClaim, {}),
    [orgId, setOrgId] = useState(""),
    [name, setName] = useState("");
  const [details, setDetails] = useState({ role: "", email: "", note: "" });
  const selected = organizations.find((o) => o.id === orgId);
  return (
    <form action={submit} className="claim-form">
      <input type="hidden" name="placeId" value={placeId} />
      {organizations.length > 0 ? (
        <label className="field">
          <span>Attach this location to</span>
          <select
            name="requested_organization_id"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            <option value="">Create a new organization</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="requested_organization_id" value="" />
      )}
      <label className="field">
        <span>Business / organization name</span>
        <input
          name="organization_name"
          value={selected?.name || name}
          readOnly={Boolean(selected)}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={160}
          autoComplete="organization"
          aria-describedby="claim-name-help"
        />
      </label>
      <p id="claim-name-help" className="fine-print">
        This business name may be displayed on Pawport after approval. For an
        existing organization, Pawport uses its saved name.
      </p>
      <label className="field">
        <span>Your role at the business</span>
        <input
          name="claimant_role"
          value={details.role}
          onChange={(e) =>
            setDetails((previous) => ({ ...previous, role: e.target.value }))
          }
          required
          maxLength={100}
          autoComplete="organization-title"
          placeholder="For example, owner or office manager"
        />
      </label>
      <label className="field">
        <span>Business email</span>
        <input
          name="business_email"
          value={details.email}
          onChange={(e) =>
            setDetails((previous) => ({ ...previous, email: e.target.value }))
          }
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          aria-describedby="claim-email-help"
        />
      </label>
      <p id="claim-email-help" className="fine-print">
        Use an email associated with the business. Pawport may use it to review
        your claim. Email ownership is not automatically verified.
      </p>
      <label className="field">
        <span>Optional note</span>
        <textarea
          name="claim_note"
          value={details.note}
          onChange={(e) =>
            setDetails((previous) => ({ ...previous, note: e.target.value }))
          }
          maxLength={1500}
          rows={4}
          placeholder="Tell us about your relationship to this business."
        />
      </label>
      <p className="fine-print">
        Claims are reviewed manually. {claimingTrustCopy} To correct a submitted
        claim, withdraw it and submit a new request.
      </p>
      {state.error && (
        <p role="alert" className="feedback error">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? "Submitting…" : "Submit claim for review"}
      </button>
    </form>
  );
}
export function WithdrawClaim({ id }: { id: string }) {
  const [state, submit, pending] = useActionState(withdrawClaim, {});
  return (
    <details className="claim-withdraw">
      <summary>Withdraw claim</summary>
      <form action={submit}>
        <input type="hidden" name="id" value={id} />
        <p>
          Withdrawing ends review of this request. You can submit a new claim if
          you need to correct your information.
        </p>
        <label className="claim-confirm">
          <input type="checkbox" name="confirm" value="yes" required /> I want
          to withdraw this pending claim.
        </label>
        <button className="button secondary" disabled={pending}>
          Confirm withdrawal
        </button>
        {state.error && <p role="alert">{state.error}</p>}
        {state.success && <p role="status">{state.success}</p>}
      </form>
    </details>
  );
}
