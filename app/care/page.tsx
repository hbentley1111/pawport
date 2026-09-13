import { PreventiveLoader } from "@/components/preventive-care/client";
import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { careContext } from "@/lib/care/data";
import { carePlans, careNotifications } from "@/lib/care-plans/data";
import { openingsData } from "@/lib/openings/data";
import {
  CareComingUp,
  CareHubLinks,
} from "@/components/care-plans/presentation";
import { CareButton } from "@/components/care-plans/actions";
export const dynamic = "force-dynamic";
export default async function Care() {
  const { db, pets, household } = await careContext();
  const [plans, notifications, openings, count] = await Promise.all([
    carePlans(db),
    careNotifications(db),
    openingsData(db),
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("household_id", household.id)
      .in("status", ["scheduled", "confirmed", "requested", "waitlisted"])
      .gte("starts_at", new Date().toISOString()),
  ]);
  return (
    <AppFrame>
      <main className="care-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">CARE</p>
            <h1>A little less to remember.</h1>
            <p className="muted">Keep up with everything your pets need.</p>
          </div>
          <Link href="/care/plans/new" className="button">
            Add care routine
          </Link>
        </header>
        <CareHubLinks
          appointments={count.error ? null : count.count}
          watches={
            openings.error
              ? null
              : openings.watches.filter((w) =>
                  ["active", "matched"].includes(w.status),
                ).length
          }
          routines={
            plans ? plans.filter((p) => p.status === "active").length : null
          }
        />
        <div className="care-page-links">
          <Link href="/costs">Costs &amp; planning</Link>
          <Link href="/records" className="document-link">
            Health Records
          </Link>
          <Link href="/appointments/new" className="document-link">
            Add appointment
          </Link>
        </div>
        <PreventiveLoader />
        <CareComingUp plans={plans} pets={pets} now={new Date().getTime()} />
        {!!notifications?.length && (
          <section className="routine-summary">
            <h2>Care reminders</h2>
            {notifications.map((n) => (
              <article key={n.id} className="routine-card">
                <p>{n.body}</p>
                <Link className="document-link" href={n.action_url}>
                  View routine
                </Link>
                <div className="care-page-links">
                  {!n.read_at && (
                    <CareButton id={n.id} action="read">
                      Mark read
                    </CareButton>
                  )}
                  <CareButton id={n.id} action="dismiss">
                    Dismiss
                  </CareButton>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </AppFrame>
  );
}
