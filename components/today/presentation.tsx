import Link from "next/link";
import { PetAvatar } from "../pet-avatar";
import type { Pet } from "@/lib/types";
import type { PawportTodayItem, TodayResult } from "@/lib/today/schema";
import { timelineTrust } from "@/lib/timeline/schema";
export type TodayPet = Pick<Pet, "id" | "name" | "species" | "photo_id">;
export function TodayEmpty({ fresh }: { fresh: boolean }) {
  return (
    <div className="today-empty">
      <h2>{fresh ? "You're all set." : "All caught up."}</h2>
      <p>
        {fresh
          ? "Add a care routine, appointment, health record, or moment and Pawport will start keeping track."
          : "Nothing needs your attention today."}
      </p>
    </div>
  );
}
export function TodayItemCard({
  item: i,
  pet,
  zone,
  children,
}: {
  item: PawportTodayItem;
  pet?: TodayPet;
  zone: string;
  children?: React.ReactNode;
}) {
  const trust = timelineTrust(i.trustState);
  const displayZone = i.dateOnly ? i.metadata.timeZone || zone : zone;
  return (
    <article className={`today-card today-${i.category}`}>
      <div className="today-pet">
        {pet && <PetAvatar pet={pet} />}
        <span className="eyebrow">{i.petName}</span>
      </div>
      <div className="today-card-body">
        <h3>{i.title}</h3>
        {i.subtitle && <p className="muted">{i.subtitle}</p>}
        {i.metadata.demo && (
          <p className="routine-provenance">Demo availability</p>
        )}
        {trust && <span className="trust-pill">{trust}</span>}
        {i.dueAt && (
          <p className="today-due">
            {i.metadata.snoozed ? "Snoozed · " : ""}
            {i.urgency === "overdue" && i.category === "care"
              ? "Overdue · "
              : ""}
            {i.urgency === "today" && i.category === "care"
              ? "Due today · "
              : ""}
            <time dateTime={i.dueAt}>
              {new Intl.DateTimeFormat("en-US", {
                timeZone: displayZone,
                weekday: "short",
                month: "short",
                day: "numeric",
                ...(i.dateOnly
                  ? {}
                  : ({ hour: "numeric", minute: "2-digit" } as const)),
              }).format(Date.parse(i.dueAt))}
            </time>
          </p>
        )}
        {i.metadata.providerName && (
          <p className="muted">{i.metadata.providerName}</p>
        )}
        {children}
        <Link className="document-link" href={i.actionUrl}>
          {i.category === "opening"
            ? "Check availability"
            : i.category === "health"
              ? "View health records"
              : i.category === "care"
                ? "View routine"
                : "View details"}
        </Link>
      </div>
    </article>
  );
}
export function ThisWeek({ summary: s }: { summary: TodayResult["summary"] }) {
  return s.nextSevenDaysCount > 0 ? (
    <section className="today-week">
      <h2>This week</h2>
      <p>
        {s.careThisWeek} care {s.careThisWeek === 1 ? "routine" : "routines"} ·{" "}
        {s.appointmentsThisWeek}{" "}
        {s.appointmentsThisWeek === 1 ? "appointment" : "appointments"}
      </p>
      <Link className="document-link" href="/care">
        View care
      </Link>
    </section>
  ) : null;
}
export function TodayQuickActions({ pets }: { pets: TodayPet[] }) {
  return (
    <section className="routine-summary">
      <h2>Quick actions</h2>
      <div className="care-page-links">
        <Link className="button secondary" href="/care/plans/new">
          Add care routine
        </Link>
        <Link className="button secondary" href="/appointments/new">
          Add appointment
        </Link>
        <Link
          className="button secondary"
          href={pets.length === 1 ? `/pets/${pets[0].id}/records` : "/records"}
        >
          Upload health record
        </Link>
        {pets.length === 1 ? (
          <Link
            className="button secondary"
            href={`/pets/${pets[0].id}/timeline/new`}
          >
            Add moment
          </Link>
        ) : (
          <details>
            <summary className="button secondary">Add moment</summary>
            <div className="today-pet-choice">
              {pets.map((p) => (
                <Link
                  className="document-link"
                  key={p.id}
                  href={`/pets/${p.id}/timeline/new`}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
