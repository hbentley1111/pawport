import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppFrame } from "@/components/app-frame";
import { careContext } from "@/lib/care/data";
import { carePlans } from "@/lib/care-plans/data";
import { reminderText, type CareHistory } from "@/lib/care-plans/schema";
import { PlanCard } from "@/components/care-plans/presentation";
import { PlanForm } from "@/components/care-plans/form";
import {
  CareButton,
  CompletionForm,
  SnoozeForm,
} from "@/components/care-plans/actions";
export const dynamic = "force-dynamic";
export default async function PlanDetail({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { db, pets } = await careContext(),
    { planId } = await params;
  if (!z.uuid().safeParse(planId).success) notFound();
  const [plans, detail] = await Promise.all([
    carePlans(db, undefined, planId),
    db.rpc("care_plan_detail", { p_id: planId }),
  ]);
  if (plans === null || detail.error)
    return (
      <AppFrame>
        <main className="care-page">
          <p role="status">Care routine temporarily unavailable.</p>
          <Link href="/care/plans">Back to care routines</Link>
        </main>
      </AppFrame>
    );
  const p = plans.find((x) => x.id === planId);
  if (!p || !detail.data) notFound();
  const history = (detail.data as { history: CareHistory[] }).history;
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="document-link" href="/care/plans">
          Back to care routines
        </Link>
        <header className="care-heading">
          <div>
            <p className="eyebrow">OWNER-ENTERED ROUTINE</p>
            <h1>{p.title}</h1>
            <p className="muted">
              This is your care schedule, not veterinarian-verified medical
              information.
            </p>
          </div>
        </header>
        <PlanCard
          plan={p}
          now={new Date().getTime()}
          pet={pets.find((pet) => pet.id === p.pet_id)}
        />
        <p className="muted">Schedule time zone: {p.time_zone}</p>
        {p.instructions && (
          <section className="routine-summary">
            <h2>Your instructions</h2>
            <p className="routine-instructions">{p.instructions}</p>
          </section>
        )}
        <p>
          Reminders:{" "}
          {p.reminders.length
            ? p.reminders.map(reminderText).join(" · ")
            : "None selected"}{" "}
          · In-app only
        </p>
        {p.ends_on && <p>Schedule ends {p.ends_on}</p>}
        {p.occurrence?.snoozed_until && (
          <p>
            Originally due:{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: p.time_zone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(Date.parse(p.occurrence.scheduled_for))}
            . Snoozed until:{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: p.time_zone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(Date.parse(p.occurrence.snoozed_until))}
            .
          </p>
        )}
        {p.status === "active" && p.occurrence && (
          <section className="routine-summary">
            <CompletionForm id={p.occurrence.id} />
            <div id="snooze">
              <SnoozeForm id={p.occurrence.id} zone={p.time_zone} />
            </div>
          </section>
        )}
        {p.status !== "archived" && (
          <>
            <div className="care-page-links">
              <Link
                href={`/pets/${p.pet_id}/costs/planning/new?carePlan=${p.id}`}
              >
                Add to cost planning
              </Link>
              <CareButton
                id={p.id}
                action={p.status === "active" ? "paused" : "active"}
              >
                {p.status === "active" ? "Pause routine" : "Resume routine"}
              </CareButton>
            </div>
            {p.status === "paused" && (
              <p className="muted">
                Reminders are paused. Resuming keeps the pending item, even if
                overdue, so you can complete or skip it.
              </p>
            )}
            <details className="routine-summary">
              <summary>Edit routine</summary>
              <PlanForm
                pets={pets.map(({ id, name }) => ({ id, name }))}
                plan={p}
              />
            </details>
            <details className="routine-summary">
              <summary>Archive routine</summary>
              <p>
                Stops this routine and cancels its pending item. History stays
                private and available. Archived routines cannot be resumed.
              </p>
              <CareButton id={p.id} action="archived">
                Archive routine
              </CareButton>
            </details>
          </>
        )}
        <section className="routine-summary">
          <h2>Recent history</h2>
          {history.length ? (
            <ol className="routine-history">
              {history.map((o) => (
                <li key={o.id}>
                  <strong>{o.title_snapshot}</strong>
                  <p>
                    {o.status.charAt(0).toUpperCase() + o.status.slice(1)} ·
                    Scheduled{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: o.time_zone_snapshot,
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(Date.parse(o.scheduled_for))}
                  </p>
                  {(o.completed_at || o.skipped_at) && (
                    <p>
                      Recorded{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: o.time_zone_snapshot,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(Date.parse(o.completed_at || o.skipped_at!))}
                    </p>
                  )}
                  {o.completion_note && (
                    <p className="routine-instructions">{o.completion_note}</p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              Your completed and skipped care will appear here.
            </p>
          )}
        </section>
      </main>
    </AppFrame>
  );
}
