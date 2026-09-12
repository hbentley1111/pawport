"use client";
import { CareFormDetails } from "./form-details";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { saveAppointment, cancelAppointment } from "@/app/appointments/actions";
import {
  reminderChoices,
  reminderLabel,
  type Appointment,
} from "@/lib/care/schema";
import {
  localDateTime,
  occurrenceFor,
  wallTimeCandidates,
} from "@/lib/care/time";
import type { Pet } from "@/lib/types";
import { useLocalZone, useCareHydrated } from "./local-time";
function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
export function AppointmentForm(props: {
  pets: Pet[];
  appointment?: Appointment;
  petId?: string;
  placeId?: string;
}) {
  const zone = useLocalZone();
  const ready = useCareHydrated();
  if (!ready)
    return (
      <>
        <p role="status" className="service-notice">
          Preparing your local time zone…
        </p>
        <noscript>
          Enable JavaScript to enter appointments in your local time zone.
        </noscript>
      </>
    );
  return (
    <Editor
      key={`${props.appointment?.id || "new"}:${zone}`}
      {...props}
      zone={zone}
    />
  );
}
function Editor({
  pets,
  appointment: a,
  petId,
  placeId,
  zone,
}: {
  pets: Pet[];
  appointment?: Appointment;
  petId?: string;
  placeId?: string;
  zone: string;
}) {
  const [state, action] = useActionState(saveAppointment, {});
  const [start, setStart] = useState(a ? localDateTime(a.starts_at, zone) : "");
  const [end, setEnd] = useState(
    a?.ends_at ? localDateTime(a.ends_at, zone) : "",
  );
  const [linked, setLinked] = useState(a?.google_place_id || placeId || "");
  function ambiguous(value: string) {
    try {
      return wallTimeCandidates(value, zone).length > 1;
    } catch {
      return false;
    }
  }
  if (!pets.length)
    return (
      <p className="feedback">
        Add a pet before recording an appointment.{" "}
        <Link href="/pets/new">Add pet</Link>
      </p>
    );
  return (
    <form action={action} className="form-stack care-form">
      {a && <input type="hidden" name="id" value={a.id} />}
      <input type="hidden" name="time_zone" value={zone} />
      <input type="hidden" name="google_place_id" value={linked} />
      <p className="care-recording-note">
        Record care you’ve arranged elsewhere. Pawport does not book or confirm
        with the provider.
      </p>
      {linked && (
        <div className="service-notice">
          <p>
            Linked to a service on Pawport. Only its Google Place ID is saved.
          </p>
          <Link
            href={`/services/${encodeURIComponent(linked)}`}
            className="document-link"
            prefetch={false}
          >
            View current business information
          </Link>
          <button
            type="button"
            className="text-button"
            onClick={() => setLinked("")}
          >
            Remove service link
          </button>
        </div>
      )}
      {a ? (
        <>
          <input type="hidden" name="pet_id" value={a.pet_id} />
          <p>
            <strong>Pet:</strong> {pets.find((p) => p.id === a.pet_id)?.name}
          </p>
        </>
      ) : (
        <label className="field">
          <span>Pet</span>
          <select name="pet_id" defaultValue={petId || pets[0]?.id} required>
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <CareFormDetails appointment={a} />
      <p className="fine-print">
        All times below are in your browser’s time zone: <strong>{zone}</strong>
        . An end date can be later for overnight care.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Start date & time</span>
          <input
            type="datetime-local"
            name="local_start"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            min="1900-01-01T00:00"
            max="2199-12-31T23:59"
          />
        </label>
        <label className="field">
          <span>End date & time (optional)</span>
          <input
            type="datetime-local"
            name="local_end"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            min="1900-01-01T00:00"
            max="2199-12-31T23:59"
          />
        </label>
      </div>
      <label className={ambiguous(start) ? "field" : "care-hidden"}>
        <span>Start time occurs twice when clocks change</span>
        <select
          name="start_occurrence"
          defaultValue={a ? occurrenceFor(a.starts_at, zone) : "earlier"}
        >
          <option value="earlier">First occurrence (earlier instant)</option>
          <option value="later">Second occurrence (later instant)</option>
        </select>
      </label>
      <label className={ambiguous(end) ? "field" : "care-hidden"}>
        <span>End time occurs twice when clocks change</span>
        <select
          name="end_occurrence"
          defaultValue={a?.ends_at ? occurrenceFor(a.ends_at, zone) : "earlier"}
        >
          <option value="earlier">First occurrence (earlier instant)</option>
          <option value="later">Second occurrence (later instant)</option>
        </select>
      </label>
      <label className="field">
        <span>Provider name or your own label (optional)</span>
        <input
          name="provider_name"
          maxLength={160}
          defaultValue={a?.provider_name || ""}
          placeholder="Dr. Smith Mobile Vet"
        />
      </label>
      <label className="field">
        <span>Location you enter (optional)</span>
        <input
          name="location_text"
          maxLength={300}
          defaultValue={a?.location_text || ""}
          placeholder="Home visit"
        />
      </label>
      {linked && (
        <p className="fine-print">
          Enter your own label and location if needed. Google business details
          are not copied into this form.
        </p>
      )}
      <label className="field">
        <span>Private notes (optional)</span>
        <textarea
          name="notes"
          rows={4}
          maxLength={2000}
          defaultValue={a?.notes || ""}
        />
      </label>
      <fieldset className="care-reminder-options">
        <legend>In-app reminders</legend>
        {reminderChoices.map((m) => (
          <label key={m}>
            <input
              type="checkbox"
              name="reminders"
              value={m}
              defaultChecked={
                a
                  ? a.appointment_reminders.some(
                      (r) => r.reminder_minutes === m,
                    )
                  : m === 1440
              }
            />
            {reminderLabel(m)}
          </label>
        ))}
        <p className="fine-print">
          Visible when you open Pawport. No email, text, or push notifications
          are sent.
        </p>
      </fieldset>
      {state.error && (
        <p role="alert" className="feedback error">
          {state.error}
        </p>
      )}
      <Submit>{a ? "Save changes" : "Add appointment"}</Submit>
    </form>
  );
}
export function CancelAppointment({ id }: { id: string }) {
  const [state, action] = useActionState(cancelAppointment, {});
  return (
    <form action={action} className="care-cancel">
      <input type="hidden" name="id" value={id} />
      <p>
        This changes your Pawport calendar only. Contact the provider
        separately.
      </p>
      <Submit>Cancel appointment</Submit>
      {state.success && (
        <p role="status" className="feedback success">
          {state.success}
        </p>
      )}
      {state.error && (
        <p role="alert" className="feedback error">
          {state.error}
        </p>
      )}
    </form>
  );
}
