import Link from "next/link";
import {
  CalendarDays,
  Repeat2,
  Sparkles,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import { PetAvatar } from "../pet-avatar";
import type { Pet } from "@/lib/types";
import {
  dueLabel,
  effectiveDue,
  relevantPlans,
  scheduleLabel,
  categoryText,
  type CarePlan,
} from "@/lib/care-plans/schema";
export function PlanCard({
  plan: p,
  now,
  pet,
}: {
  plan: CarePlan;
  now: number;
  pet?: Pet;
}) {
  const o = p.occurrence;
  return (
    <article className="routine-card">
      <div className="routine-identity">
        {pet && <PetAvatar pet={pet} />}
        <div>
          <p className="eyebrow">
            {p.pet_name} · {categoryText(p.category)}
          </p>
          <h3>
            <Link href={`/care/plans/${p.id}`}>{p.title}</Link>
          </h3>
        </div>
      </div>
      <div className="routine-meta">
        <span className="trust-pill">{dueLabel(p, now)}</span>
        <span>{scheduleLabel(p)}</span>
        {o && (
          <time dateTime={new Date(effectiveDue(o)).toISOString()}>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: p.time_zone,
              month: "short",
              day: "numeric",
              year: "numeric",
              ...(p.anchor_local_time || o.snoozed_until
                ? ({ hour: "numeric", minute: "2-digit" } as const)
                : {}),
            }).format(effectiveDue(o))}
          </time>
        )}
      </div>
      <p className="routine-provenance">Owner-entered routine</p>
      <Link className="document-link" href={`/care/plans/${p.id}`}>
        View routine <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </article>
  );
}
export function RoutineEmpty() {
  return (
    <div className="care-empty">
      <Repeat2 size={28} aria-hidden="true" />
      <h2>Nothing to remember yet.</h2>
      <p>
        Add medications, grooming, preventives, or any routine you want Pawport
        to remember.
      </p>
      <Link href="/care/plans/new" className="button">
        <Plus size={16} aria-hidden="true" />
        Add care routine
      </Link>
    </div>
  );
}
export function CareComingUp({
  plans,
  now,
  pets,
  petId,
}: {
  plans: CarePlan[] | null;
  now: number;
  pets: Pet[];
  petId?: string;
}) {
  const items = plans
    ? relevantPlans(plans, now, petId, !petId).slice(0, 3)
    : [];
  return (
    <section
      className="routine-summary"
      aria-label={petId ? "Pet care routines" : "Care coming up"}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE LITTLE THINGS, REMEMBERED</p>
          <h2>{petId ? "Care" : "Care coming up"}</h2>
        </div>
        <Link
          href={`/care/plans${petId ? `?pet=${petId}` : ""}`}
          className="document-link"
        >
          View all care
        </Link>
      </div>
      {plans === null ? (
        <p role="status" className="muted">
          Care routines are temporarily unavailable.
        </p>
      ) : items.length ? (
        <div className="routine-grid">
          {items.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              now={now}
              pet={pets.find((pet) => pet.id === p.pet_id)}
            />
          ))}
        </div>
      ) : (
        <p className="muted">
          {petId
            ? "No care routines coming up."
            : "Nothing coming up this week."}{" "}
          <Link href={`/care/plans/new${petId ? `?pet=${petId}` : ""}`}>
            Add care routine
          </Link>
        </p>
      )}
    </section>
  );
}
export function CareHubLinks({
  appointments,
  watches,
  routines,
}: {
  appointments: number | null;
  watches: number | null;
  routines: number | null;
}) {
  return (
    <div className="routine-grid care-hub-links">
      {[
        {
          href: "/appointments",
          title: "Appointments",
          detail:
            appointments === null
              ? "Calendar unavailable"
              : `${appointments} upcoming`,
          icon: CalendarDays,
        },
        {
          href: "/care/plans",
          title: "Care routines",
          detail:
            routines === null ? "Routines unavailable" : `${routines} active`,
          icon: Repeat2,
        },
        {
          href: "/openings",
          title: "Smart Openings",
          detail:
            watches === null
              ? "Openings unavailable"
              : `${watches} active watches`,
          icon: Sparkles,
        },
      ].map(({ href, title, detail, icon: Icon }) => (
        <Link key={href} href={href} className="routine-card">
          <Icon size={23} aria-hidden="true" />
          <h2>{title}</h2>
          <p className="muted">{detail}</p>
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
