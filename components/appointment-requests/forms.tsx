"use client";
import { useActionState, useState } from "react";
import {
  sendRequest,
  respondToRequest,
  saveRequestSettings,
  type RequestResult,
} from "@/app/appointments/request/actions";
import type {
  Intake,
  RequestItem,
  RequestSettings,
} from "@/lib/appointment-requests/schema";
function Result({ state }: { state: RequestResult }) {
  return (
    <>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
    </>
  );
}
export function RequestForm({
  intake,
  pets,
}: {
  intake: Intake;
  pets: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(sendRequest, {});
  const [count, setCount] = useState(1);
  return (
    <form action={action} className="business-panel business-form">
      <input type="hidden" name="location" value={intake.locationId} />
      <h2>Preferred times</h2>
      <p>
        Times use {intake.timeZone}. During a repeated clock-change hour, the
        first occurrence is used.
      </p>
      <p>
        Give at least {intake.minimumNoticeHours} hours’ notice, up to{" "}
        {intake.maximumAdvanceDays} days ahead.
      </p>
      {intake.instructions && <p>{intake.instructions}</p>}
      <label>
        Pet
        <select name="pet" required>
          {pets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Service
        <select name="service" required>
          {intake.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {Array.from({ length: count }, (_, i) => (
        <fieldset key={i}>
          <legend>Preferred window {i + 1}</legend>
          <div className="business-field-pair">
            <label>
              Start
              <input type="datetime-local" name={`start${i}`} required />
            </label>
            <label>
              End
              <input type="datetime-local" name={`end${i}`} required />
            </label>
          </div>
        </fieldset>
      ))}
      <div className="provider-actions">
        {count < 3 && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setCount(count + 1)}
          >
            Add another time
          </button>
        )}
        {count > 1 && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setCount(count - 1)}
          >
            Remove last window
          </button>
        )}
      </div>
      <label>
        Contact name
        <input
          name="contactName"
          autoComplete="name"
          required
          maxLength={120}
        />
      </label>
      <label>
        Phone (optional)
        <input name="phone" type="tel" autoComplete="tel" maxLength={40} />
      </label>
      <label>
        Anything the business should know?
        <textarea name="note" maxLength={1000} />
      </label>
      <p>
        Your pet&apos;s name, species, contact information, preferred times and
        note will be shared with this business. Your confirmed account email is
        used.
      </p>
      <label className="business-check">
        <input type="checkbox" name="consent" value="yes" required />I agree to
        share this information for this appointment request.
      </label>
      <p>
        The business will confirm or suggest another time. Nothing is booked
        until the appointment is confirmed.
      </p>
      <Result state={state} />
      <button className="button" disabled={pending}>
        {pending ? "Sending…" : "Send appointment request"}
      </button>
    </form>
  );
}
function Transition({
  item,
  org,
  operation,
  label,
  times = false,
  message = false,
  confirm = false,
}: {
  item: RequestItem;
  org?: string;
  operation: string;
  label: string;
  times?: boolean;
  message?: boolean;
  confirm?: boolean;
}) {
  const [state, action, pending] = useActionState(respondToRequest, {});
  return (
    <form action={action} className="business-panel business-form">
      <h3>{label}</h3>
      <input type="hidden" name="request" value={item.requestId} />
      <input type="hidden" name="organization" value={org || ""} />
      <input type="hidden" name="proposal" value={item.proposal?.id || ""} />
      <input type="hidden" name="operation" value={operation} />
      {times && (
        <>
          <p>
            Times in {item.timeZone}. The first occurrence of a repeated hour is
            used.
          </p>
          <div className="business-field-pair">
            <label>
              Start
              <input type="datetime-local" name="start" required />
            </label>
            <label>
              End
              <input type="datetime-local" name="end" required />
            </label>
          </div>
          {operation === "confirm" && (
            <p>The exact time must fit entirely inside one preferred window.</p>
          )}
        </>
      )}
      {message && (
        <label>
          Message shared with the owner (optional)
          <textarea name="message" maxLength={500} />
        </label>
      )}
      {confirm && (
        <label className="business-check">
          <input type="checkbox" name="confirm" value="yes" required />
          Confirm this action
        </label>
      )}
      <Result state={state} />
      <button disabled={pending} className="button secondary">
        {pending ? "Saving…" : label}
      </button>
    </form>
  );
}
export function RequestActions({
  item,
  org,
  canRespond = true,
}: {
  item: RequestItem;
  org?: string;
  canRespond?: boolean;
}) {
  const open = ["requested", "provider_proposed"].includes(item.status);
  if (org && !canRespond)
    return <p className="fine-print">Read-only request access.</p>;
  return (
    <section aria-label="Request actions">
      {org ? (
        <>
          {open && (
            <>
              <Transition
                item={item}
                org={org}
                operation="confirm"
                label="Confirm time"
                times
              />
              <Transition
                item={item}
                org={org}
                operation="propose"
                label="Propose another time"
                times
                message
              />
              <Transition
                item={item}
                org={org}
                operation="decline"
                label="Decline request"
                message
                confirm
              />
            </>
          )}
          {item.status === "confirmed" && (
            <Transition
              item={item}
              org={org}
              operation="provider_cancel"
              label="Cancel appointment"
              message
              confirm
            />
          )}
        </>
      ) : (
        <>
          {item.status === "provider_proposed" &&
            item.proposal?.status === "pending" && (
              <>
                <Transition
                  item={item}
                  operation="accept"
                  label="Accept proposed time"
                />
                <Transition
                  item={item}
                  operation="reject_proposal"
                  label="Decline proposed time"
                />
              </>
            )}
          {open && (
            <Transition
              item={item}
              operation="withdraw"
              label="Withdraw request"
              confirm
            />
          )}
          {item.status === "confirmed" && (
            <Transition
              item={item}
              operation="owner_cancel"
              label="Cancel appointment"
              confirm
            />
          )}
        </>
      )}
    </section>
  );
}
export function IntakeSettings({
  org,
  data,
}: {
  org: string;
  data: RequestSettings;
}) {
  const [state, action, pending] = useActionState(saveRequestSettings, {});
  const s = data.settings;
  return (
    <section className="business-panel">
      <h2>Appointment request settings</h2>
      <form action={action} className="business-form">
        <input type="hidden" name="organization" value={org} />
        <input type="hidden" name="location" value={data.locationId} />
        <label className="business-check">
          <input
            type="checkbox"
            name="enabled"
            value="yes"
            defaultChecked={s.requests_enabled}
          />
          Accept appointment requests
        </label>
        <div className="business-field-pair">
          <label>
            Minimum notice (hours)
            <input
              name="notice"
              type="number"
              min={0}
              max={336}
              required
              defaultValue={s.minimum_notice_hours}
            />
          </label>
          <label>
            Maximum advance (days)
            <input
              name="advance"
              type="number"
              min={1}
              max={180}
              required
              defaultValue={s.maximum_advance_days}
            />
          </label>
        </div>
        <label>
          Instructions
          <textarea
            name="instructions"
            maxLength={1000}
            defaultValue={s.instructions || ""}
          />
        </label>
        <Result state={state} />
        <button disabled={pending} className="button">
          Save request settings
        </button>
      </form>
      <h3>Requestable services</h3>
      <p>
        Publish the location profile with a timezone and choose at least one
        service to accept requests.
      </p>
      {data.services.map((service) => (
        <ServiceToggle
          key={`${service.id}:${service.enabled}`}
          org={org}
          location={data.locationId}
          service={service}
        />
      ))}
    </section>
  );
}
function ServiceToggle({
  org,
  location,
  service,
}: {
  org: string;
  location: string;
  service: RequestSettings["services"][number];
}) {
  const [state, action, pending] = useActionState(saveRequestSettings, {});
  return (
    <form action={action} className="business-form">
      <input type="hidden" name="organization" value={org} />
      <input type="hidden" name="location" value={location} />
      <input type="hidden" name="service" value={service.id} />
      <input type="hidden" name="operation" value="service" />
      <label className="business-check">
        <input
          type="checkbox"
          name="enabled"
          value="yes"
          defaultChecked={service.enabled}
        />
        {service.name} — accept appointment requests
      </label>
      <Result state={state} />
      <button className="button secondary" disabled={pending}>
        Save service preference
      </button>
    </form>
  );
}
