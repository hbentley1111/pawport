"use client";
import Link from "next/link";
import { ArrowUpRight, Bell, Plus, FileHeart } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CareEntry, CareEmpty, CareCalendarEmpty } from "./presentation";
import type { Pet } from "@/lib/types";
import {
  filterCare,
  reminderLabel,
  reminderState,
  upcoming,
  type Appointment,
} from "@/lib/care/schema";
import { careDate, localDateTime } from "@/lib/care/time";
import { useLocalZone, useCareClock, CareDateTime } from "./local-time";
import { dismissReminder } from "@/app/appointments/actions";
function DismissSubmit() {
  const { pending } = useFormStatus();
  return (
    <button className="text-button" disabled={pending}>
      {pending ? "Dismissing…" : "Dismiss"}
    </button>
  );
}
function ReminderNotice({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(dismissReminder, {});
  return (
    <form
      action={action}
      className="care-reminder"
      aria-label="In-app reminder"
    >
      <input type="hidden" name="id" value={id} />
      <Bell size={15} aria-hidden="true" />
      <span>{state.success || label}</span>
      {!state.success && <DismissSubmit />}
      {state.error && <span role="alert">{state.error}</span>}
    </form>
  );
}
export function CareCard({
  appointment: a,
  pet,
  zone,
  now,
  compact = false,
}: {
  appointment: Appointment;
  pet: Pet;
  zone: string;
  now: number;
  compact?: boolean;
}) {
  const due = a.appointment_reminders.filter(
    (r) => reminderState(a, r, now) === "due",
  );
  return (
    <article className={`care-card care-status-${a.status}`}>
      <CareEntry appointment={a} pet={pet} zone={zone} />
      {!compact && a.appointment_reminders.length > 0 && (
        <details className="care-reminder-plan">
          <summary>In-app reminders ({a.appointment_reminders.length})</summary>
          <ul>
            {a.appointment_reminders.map((r) => (
              <li key={r.id}>
                {reminderLabel(r.reminder_minutes)} ·{" "}
                {reminderState(a, r, now) === "pending" ? (
                  <CareDateTime
                    value={new Date(
                      Date.parse(a.starts_at) - r.reminder_minutes * 60000,
                    ).toISOString()}
                    zone={zone}
                  />
                ) : (
                  reminderState(a, r, now)
                )}
              </li>
            ))}
          </ul>
          <p>No notifications are sent outside PetThread.</p>
        </details>
      )}
      {due.map((r) => (
        <ReminderNotice
          key={r.id}
          id={r.id}
          label={`${reminderLabel(r.reminder_minutes)} · due in PetThread`}
        />
      ))}
    </article>
  );
}
export function UpcomingCare({
  appointments,
  pets,
  petId,
  now,
}: {
  appointments: Appointment[] | null;
  pets: Pet[];
  petId?: string;
  now: number;
}) {
  const zone = useLocalZone(),
    clock = useCareClock(now);
  const visible = appointments?.filter(
    (a) => upcoming(a, clock) && (!petId || a.pet_id === petId),
  );
  const pet = petId ? pets.find((p) => p.id === petId) : undefined;
  return (
    <section className="upcoming-care" aria-label="Upcoming care">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A LITTLE LOOK AHEAD</p>
          <h2>Upcoming care</h2>
        </div>
        <Link
          className="document-link"
          href={`/appointments${petId ? `?pet=${petId}` : ""}`}
        >
          View all appointments <ArrowUpRight size={15} />
        </Link>
      </div>
      {visible === undefined ? (
        <p className="feedback">
          Your care calendar is temporarily unavailable.
        </p>
      ) : visible.length ? (
        <div className="care-summary-list">
          {visible.map((a) => {
            const p = pets.find((p) => p.id === a.pet_id);
            return p ? (
              <CareCard
                key={a.id}
                compact
                appointment={a}
                pet={p}
                zone={zone}
                now={clock}
              />
            ) : null;
          })}
        </div>
      ) : (
        <CareEmpty petName={pet?.name} />
      )}
      <Link
        className="button secondary small"
        href={`/appointments/new${petId ? `?pet=${petId}` : ""}`}
      >
        <Plus size={16} /> Add appointment
      </Link>
      <p className="fine-print">
        Times shown in {zone}. Reminders appear in PetThread; no email or push
        is sent.
      </p>
    </section>
  );
}
export function CareTimeline({
  appointments,
  pets,
  now,
  view,
}: {
  appointments: Appointment[];
  pets: Pet[];
  now: number;
  view: "upcoming" | "past";
}) {
  const zone = useLocalZone(),
    clock = useCareClock(now);
  const visible = filterCare(appointments, view, clock);
  const groups = new Map<string, Appointment[]>();
  for (const a of visible) {
    const key = localDateTime(a.starts_at, zone).slice(0, 10);
    groups.set(key, [...(groups.get(key) || []), a]);
  }
  return (
    <>
      <p className="fine-print">
        Times shown in {zone}.{" "}
        {view === "past"
          ? "Includes cancelled and completed appointments, even when their date is in the future."
          : "These are appointments you record, not bookings made by PetThread."}
      </p>
      {!visible.length ? (
        <CareCalendarEmpty past={view === "past"} />
      ) : (
        [...groups].map(([date, list]) => (
          <section className="care-date-group" key={date}>
            <h2>{careDate(list[0].starts_at, zone)}</h2>
            {list.map((a) => {
              const pet = pets.find((p) => p.id === a.pet_id);
              return pet ? (
                <CareCard
                  key={a.id}
                  appointment={a}
                  pet={pet}
                  zone={zone}
                  now={clock}
                />
              ) : null;
            })}
          </section>
        ))
      )}
      <Link href="/records" className="document-link">
        <FileHeart size={17} /> Health Records
      </Link>
    </>
  );
}
