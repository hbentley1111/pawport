"use client";
import { brandLabel } from "@/lib/brand";

import { useLocalZone } from "../care/local-time";
import Link from "next/link";
import {
  Heart,
  CalendarDays,
  Check,
  Camera,
  Scale,
  Star,
  BookOpen,
} from "lucide-react";
import {
  timelineDay,
  timelineTrust,
  type PetTimelineEvent,
} from "@/lib/timeline/schema";
import { JournalPhoto } from "./photo";
export function TimelineCard({
  event: e,
  compact = false,
}: {
  event: PetTimelineEvent;
  compact?: boolean;
}) {
  const Icon =
    e.category === "health"
      ? Heart
      : e.category === "appointments"
        ? CalendarDays
        : e.category === "care"
          ? Check
          : e.eventType === "journal_photo"
            ? Camera
            : e.eventType === "journal_weight"
              ? Scale
              : e.eventType === "journal_milestone"
                ? Star
                : BookOpen;
  const trust =
    e.sourceType === "vaccination" ? timelineTrust(e.trustState) : null;
  return (
    <article className="timeline-card">
      <span className="timeline-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div className="timeline-content">
        <h3>
          <Link href={e.actionUrl}>{e.title}</Link>
        </h3>
        {e.subtitle && <p className="muted">{e.subtitle}</p>}
        {trust && <span className="trust-pill">{trust}</span>}
        {e.eventType === "journal_weight" &&
          e.metadata.weightValue !== undefined && (
            <p>
              {e.metadata.weightValue} {e.metadata.weightUnit} · Owner-entered
              measurement
            </p>
          )}
        {!compact && e.description && (
          <p className="journal-note">
            {e.sourceType === "appointment"
              ? brandLabel(e.description)
              : e.description}
          </p>
        )}
        {!compact && e.photoUrl && (
          <JournalPhoto src={e.photoUrl} title={e.title} />
        )}
        <Link className="document-link" href={e.actionUrl}>
          {e.sourceType === "journal" ? "View moment" : "View source record"}
        </Link>
      </div>
    </article>
  );
}
export function TimelineEmpty({ petId }: { petId: string }) {
  return (
    <div className="care-empty">
      <BookOpen size={30} aria-hidden="true" />
      <h2>No memories yet.</h2>
      <p>
        As you add care, records, appointments, and moments, PetThread will
        build their story here.
      </p>
      <Link className="button" href={`/pets/${petId}/timeline/new`}>
        Add a moment
      </Link>
    </div>
  );
}
export function TimelineList({
  events,
  zone,
}: {
  events: PetTimelineEvent[];
  zone?: string;
}) {
  const localZone = useLocalZone();
  const displayZone = zone || localZone;
  return (
    <div className="pet-timeline">
      {events.map((e, index) => {
        const current = timelineDay(e.occurredAt, displayZone),
          show =
            index === 0 ||
            current !== timelineDay(events[index - 1].occurredAt, displayZone);
        return (
          <div key={e.id}>
            {show && (
              <h2 className="timeline-date">
                <time dateTime={e.occurredAt}>{current}</time>
              </h2>
            )}
            <TimelineCard event={e} />
          </div>
        );
      })}
    </div>
  );
}
export function RecentActivity({
  events,
  petId,
  zone,
}: {
  events: PetTimelineEvent[] | null;
  petId: string;
  zone?: string;
}) {
  const localZone = useLocalZone();
  const displayZone = zone || localZone;
  return (
    <section className="routine-summary">
      <div className="section-heading">
        <h2>Recent activity</h2>
        <Link className="document-link" href={`/pets/${petId}/timeline`}>
          View full timeline
        </Link>
      </div>
      {events === null ? (
        <p className="muted">Recent activity is temporarily unavailable.</p>
      ) : !events.length ? (
        <p className="muted">
          Their story starts here.{" "}
          <Link href={`/pets/${petId}/timeline/new`}>Add a moment</Link>
        </p>
      ) : (
        events.slice(0, 3).map((e) => (
          <div key={e.id}>
            <p className="eyebrow">{timelineDay(e.occurredAt, displayZone)}</p>
            <TimelineCard event={e} compact />
          </div>
        ))
      )}
    </section>
  );
}
