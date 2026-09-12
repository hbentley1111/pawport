"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  mutateProfile,
  type ProfileResult,
} from "@/app/provider/businesses/actions";
import {
  categories,
  days,
  type ProfileEditor,
  type LocationEditor,
  type Hours,
  type BusinessService,
} from "@/lib/business-profiles/schema";
function Form({
  org,
  location,
  operation,
  children,
  label = "Save changes",
}: {
  org: string;
  location?: string;
  operation: string;
  children: React.ReactNode;
  label?: string;
}) {
  const [state, action, pending] = useActionState(
    mutateProfile,
    {} as ProfileResult,
  );
  return (
    <form action={action} className="business-form">
      <input type="hidden" name="organization" value={org} />
      <input type="hidden" name="location" value={location || ""} />
      <input type="hidden" name="operation" value={operation} />
      {children}
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        {state.success && <p>{state.success}</p>}
      </div>
    </form>
  );
}
function Field({
  name,
  label,
  value,
  max = 160,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  value?: string | null;
  max?: number;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value || ""}
        maxLength={max}
        required={required}
      />
    </label>
  );
}
export function OrganizationForm({ editor: e }: { editor: ProfileEditor }) {
  return (
    <Form org={e.id} operation="organization">
      <Field
        name="name"
        label="Business / organization name"
        value={e.name}
        required
      />
      <Field name="tagline" label="Tagline" value={e.tagline} />
      <label>
        Description
        <textarea
          name="description"
          defaultValue={e.description || ""}
          maxLength={3000}
          rows={6}
        />
      </label>
      <Field
        name="website_url"
        label="Website (http:// or https://)"
        value={e.website_url}
        max={2048}
        type="url"
      />
      <Field
        name="public_email"
        label="Public email"
        value={e.public_email}
        max={254}
        type="email"
      />
      <p className="fine-print">
        This email will be visible on your public Pawport profile. It is
        separate from your private claim email.
      </p>
      <Field
        name="public_phone"
        label="Public phone"
        value={e.public_phone}
        max={40}
        type="tel"
      />
      <p className="fine-print">
        Enter your own business information. Saving updates all published
        locations that use these organization details.
      </p>
    </Form>
  );
}
export function LocationForm({
  org,
  location: l,
}: {
  org: string;
  location: LocationEditor;
}) {
  return (
    <Form org={org} location={l.id} operation="location">
      <Field
        name="display_name"
        label="Location display name (optional)"
        value={l.fields.display_name}
      />
      <Field
        name="address_line1"
        label="Address line 1"
        value={l.fields.address_line1}
      />
      <Field
        name="address_line2"
        label="Address line 2"
        value={l.fields.address_line2}
      />
      <div className="business-field-pair">
        <Field name="city" label="City" value={l.fields.city} max={100} />
        <Field
          name="region"
          label="State / region"
          value={l.fields.region}
          max={100}
        />
        <Field
          name="postal_code"
          label="Postal code"
          value={l.fields.postal_code}
          max={30}
        />
        <Field
          name="country_code"
          label="Country code (e.g. US)"
          value={l.fields.country_code}
          max={2}
        />
      </div>
      <Field
        name="public_phone"
        label="Location phone (optional)"
        value={l.fields.public_phone}
        max={40}
        type="tel"
      />
      <Field
        name="website_url"
        label="Location website (optional)"
        value={l.fields.website_url}
        max={2048}
        type="url"
      />
      <Field
        name="time_zone"
        label="Hours timezone (e.g. America/New_York)"
        value={l.fields.time_zone}
        max={100}
      />
      <p className="fine-print">
        All fields are business-provided. A blank location phone or website uses
        your organization’s information.
      </p>
    </Form>
  );
}
function DayHours({ day, rows }: { day: number; rows: Hours[] }) {
  const [mode, setMode] = useState(
    rows.some((x) => x.is_24_hours) ? "24" : rows.length ? "open" : "closed",
  );
  return (
    <fieldset className="business-day">
      <legend>{days[day]}</legend>
      <label className="sr-only" htmlFor={`day-${day}`}>
        {days[day]} hours
      </label>
      <select
        id={`day-${day}`}
        name={`day_${day}`}
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        <option value="closed">Closed</option>
        <option value="open">Opening windows</option>
        <option value="24">Open 24 hours</option>
      </select>
      {mode === "open" &&
        [1, 2].map((slot) => (
          <div className="business-field-pair" key={slot}>
            <label>
              Opens {slot === 2 ? "(second window, optional)" : ""}
              <input
                type="time"
                name={`open_${day}_${slot}`}
                defaultValue={rows.find((x) => x.slot === slot)?.opens_at || ""}
                required={slot === 1}
              />
            </label>
            <label>
              Closes
              <input
                type="time"
                name={`close_${day}_${slot}`}
                defaultValue={
                  rows.find((x) => x.slot === slot)?.closes_at || ""
                }
                required={slot === 1}
              />
            </label>
          </div>
        ))}
    </fieldset>
  );
}
export function HoursForm({
  org,
  location: l,
}: {
  org: string;
  location: LocationEditor;
}) {
  const [provided, setProvided] = useState(l.preview.hoursProvided);
  return (
    <Form org={org} location={l.id} operation="hours" label="Save hours">
      <label className="business-check">
        <input
          type="checkbox"
          name="hours_provided"
          value="yes"
          checked={provided}
          onChange={(e) => setProvided(e.target.checked)}
        />
        Provide weekly business hours
      </label>
      <p className="fine-print">
        When enabled, days without opening windows are shown as Closed.
        Overnight windows are not supported. Times use the location timezone.
      </p>
      <fieldset
        hidden={!provided}
        disabled={!provided}
        className="business-hours-fields"
      >
        {days.map((_, day) => (
          <DayHours
            key={day}
            day={day}
            rows={l.preview.hours.filter((h) => h.day_of_week === day)}
          />
        ))}
      </fieldset>
    </Form>
  );
}
function ServiceForm({
  org,
  location,
  service: s,
}: {
  org: string;
  location: string;
  service?: BusinessService;
}) {
  return (
    <Form
      org={org}
      location={location}
      operation="service"
      label={s ? "Save service" : "Add service"}
    >
      <input type="hidden" name="service" value={s?.id || ""} />
      <Field
        name="name"
        label="Service name"
        value={s?.name}
        max={120}
        required
      />
      <label>
        Category
        <select name="category" defaultValue={s?.category || "other"}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        Description (optional)
        <textarea
          name="description"
          defaultValue={s?.description || ""}
          maxLength={500}
          rows={3}
        />
      </label>
      <label>
        Display order
        <input
          type="number"
          name="display_order"
          min={0}
          max={1000}
          defaultValue={s?.display_order || 0}
          required
        />
      </label>
    </Form>
  );
}
export function ServicesEditor({
  org,
  location: l,
}: {
  org: string;
  location: LocationEditor;
}) {
  return (
    <>
      <p className="fine-print">
        Describe the services you offer. Categories do not establish medical
        credentials or enable appointment booking.
      </p>
      {l.preview.services.map((s) => (
        <details key={s.id} className="business-service-edit">
          <summary>{s.name}</summary>
          <ServiceForm org={org} location={l.id} service={s} />
          <Form
            org={org}
            location={l.id}
            operation="archive-service"
            label="Archive service"
          >
            <input type="hidden" name="service" value={s.id} />
          </Form>
        </details>
      ))}
      {l.preview.services.length < 50 ? (
        <details className="business-service-edit">
          <summary>Add a service</summary>
          <ServiceForm org={org} location={l.id} />
        </details>
      ) : (
        <p>You have reached the limit of 50 active services.</p>
      )}
    </>
  );
}
export function PublicationForm({
  org,
  location: l,
}: {
  org: string;
  location: LocationEditor;
}) {
  const published = l.profileStatus === "published";
  return (
    <Form
      org={org}
      location={l.id}
      operation="publication"
      label={published ? "Unpublish profile" : "Publish profile"}
    >
      <input
        type="hidden"
        name="status"
        value={published ? "unpublished" : "published"}
      />
      <p>
        Current status: <strong>{l.profileStatus}</strong>
      </p>
      <label className="business-check">
        <input type="checkbox" name="confirm" value="yes" required />
        {published
          ? "Remove this profile from public view. My listing will remain claimed."
          : "I have reviewed the saved preview and want this business information to be public."}
      </label>
      <p className="fine-print">
        Publication does not grant veterinary verification or scheduling access.
        Future saved edits to a published profile become visible immediately.
      </p>
    </Form>
  );
}
export function LogoUpload({ org }: { org: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="business-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setPending(true);
        setMessage("");
        try {
          const r = await fetch("/provider/businesses/logo-upload", {
            method: "POST",
            body: new FormData(form),
          });
          const data = await r.json();
          setMessage(data.error || "Logo saved.");
          if (r.ok) {
            form.reset();
            router.refresh();
          }
        } catch {
          setMessage("Logo upload failed. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="organization" value={org} />
      <label>
        Business logo
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
        />
      </label>
      <p className="fine-print">
        JPG, PNG or WebP · Up to 3 MiB. The logo becomes public only on
        published profiles.
      </p>
      <button className="button secondary" disabled={pending}>
        {pending ? "Uploading…" : "Upload / replace logo"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
