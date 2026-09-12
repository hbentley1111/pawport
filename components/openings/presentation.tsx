import { formatDate } from "@/lib/validation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { WatchSummary, OpeningMatch } from "@/lib/openings/schema";
import { watchStatusLabel } from "@/lib/openings/schema";
import { careDate, careTime } from "@/lib/care/time";
export function OpeningsEmpty() {
  return (
    <section className="account-card">
      <Sparkles aria-hidden="true" />
      <h2>No opening watches yet.</h2>
      <p>
        When a provider supports availability, you can watch for an earlier
        opening from your synced appointment.
      </p>
      <p className="fine-print">
        Live availability is not connected yet. You can still record and manage
        care in Pawport.
      </p>
      <Link className="button secondary" href="/appointments">
        View care calendar
      </Link>
    </section>
  );
}
export function WatchOverview({ watch: w }: { watch: WatchSummary }) {
  return (
    <>
      <p className="eyebrow">
        {w.system === "mock" ? "DEMO AVAILABILITY · " : ""}
        {w.pet_name}
      </p>
      <h2>
        {w.appointment_id
          ? "Watching for an earlier appointment"
          : "Watching for an opening"}
      </h2>
      <p>{w.provider_name}</p>
      <span className="care-status">{watchStatusLabel(w.status)}</span>
      {w.current_appointment_start && (
        <p>
          Current: {careDate(w.current_appointment_start, w.time_zone)} ·{" "}
          {careTime(w.current_appointment_start, w.time_zone)}
        </p>
      )}
      <p>
        Looking for: {formatDate(w.earliest_date)} – {formatDate(w.latest_date)}
      </p>
      <p>
        {w.allowed_weekdays
          ? w.allowed_weekdays
              .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
              .join(", ")
          : "Any day"}{" "}
        · {w.earliest_time?.slice(0, 5) || "Any start time"}
        {w.latest_time ? ` – ${w.latest_time.slice(0, 5)}` : ""} ({w.time_zone})
      </p>
      <p className="fine-print">
        {w.last_checked_at
          ? `Last checked ${careDate(w.last_checked_at, w.time_zone)} · ${careTime(w.last_checked_at, w.time_zone)}`
          : "Not checked yet. No recurring availability checks are running in this phase."}
      </p>
      {w.status === "connection_unavailable" && (
        <p className="feedback">
          Availability is temporarily unavailable. Your watch is preserved.
        </p>
      )}
    </>
  );
}
export function MatchOverview({
  watch: w,
  match: m,
}: {
  watch: WatchSummary;
  match: OpeningMatch;
}) {
  return (
    <>
      <p className="eyebrow">
        {w.system === "mock" ? "DEMO AVAILABILITY" : "SMART OPENINGS"}
      </p>
      <h3>An earlier opening was found.</h3>
      <p>
        {w.provider_name} · {w.pet_name}
      </p>
      <p>
        {careDate(m.starts_at, w.time_zone)} ·{" "}
        {careTime(m.starts_at, w.time_zone)}
      </p>
      <span className="care-status">
        {m.status === "notified" ? "Opening found" : m.status}
      </span>
      <p className="fine-print">
        Last seen {careDate(m.last_seen_at, w.time_zone)} ·{" "}
        {careTime(m.last_seen_at, w.time_zone)}. Availability can change
        quickly. This opening is not reserved. Direct booking is not connected;
        confirm availability with the provider.
      </p>
    </>
  );
}
export function OpeningsSummary({
  watches,
  petId,
}: {
  watches: WatchSummary[];
  petId?: string;
}) {
  const visible = watches.filter(
    (w) =>
      (!petId || w.pet_id === petId) &&
      ["active", "matched", "connection_unavailable"].includes(w.status),
  );
  if (!visible.length) return null;
  const matched = visible.find((w) =>
    w.matches.some((m) => ["available", "notified"].includes(m.status)),
  );
  return (
    <section className="opening-home">
      <Sparkles aria-hidden="true" />
      <div>
        <h2>Smart Openings</h2>
        <p>
          {matched
            ? `An earlier opening was found for ${matched.pet_name}.`
            : `${visible.length} ${visible.length === 1 ? "watch" : "watches"} for earlier care.`}
          {visible.some((w) => w.system === "mock")
            ? " Demo availability."
            : ""}
        </p>
      </div>
      <Link href="/openings" className="document-link">
        View openings →
      </Link>
    </section>
  );
}
export function WatchCallToAction({
  appointmentId,
  supported,
}: {
  appointmentId: string;
  supported: boolean;
}) {
  return supported ? (
    <Link
      className="button secondary"
      href={`/appointments/${appointmentId}/watch`}
    >
      Watch for an earlier opening
    </Link>
  ) : null;
}
