import Link from "next/link";
import { careContext } from "@/lib/care/data";
import { openingsData } from "@/lib/openings/data";
import { AppFrame } from "@/components/app-frame";
import {
  OpeningsEmpty,
  MatchOverview,
} from "@/components/openings/presentation";
import { WatchCard } from "@/components/openings/watch-card";
import { OpeningAction } from "@/components/openings/actions";
export const dynamic = "force-dynamic";
export default async function Openings() {
  const { db } = await careContext();
  const data = await openingsData(db);
  const current = data.watches.filter(
      (w) => !["expired", "cancelled"].includes(w.status),
    ),
    past = data.watches.filter((w) =>
      ["expired", "cancelled"].includes(w.status),
    );
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="account-back" href="/appointments">
          ← Care calendar
        </Link>
        <p className="eyebrow">A LITTLE FLEXIBILITY FOR THEIR CARE</p>
        <h1>Openings.</h1>
        <p className="muted">
          Watch for an earlier appointment, without changing the one you have.
        </p>
        {data.error ? (
          <p role="status">Smart Openings is temporarily unavailable.</p>
        ) : (
          <>
            {!data.watches.length ? (
              <OpeningsEmpty />
            ) : (
              <>
                <section aria-label="In-app notifications">
                  <h2>Notifications</h2>
                  <p className="fine-print">
                    In-app only. No email or push notifications are sent.
                  </p>
                  {data.notifications
                    .filter((n) => !n.dismissed_at)
                    .map((n) => (
                      <article className="opening-notification" key={n.id}>
                        <div>
                          <h3>{n.title}</h3>
                          <p>{n.body}</p>
                          <Link href={n.action_url}>View opening</Link>
                        </div>
                        <div className="opening-actions">
                          {!n.read_at && (
                            <OpeningAction
                              id={n.id}
                              action="read"
                              label="Mark read"
                            />
                          )}
                          <OpeningAction
                            id={n.id}
                            action="dismiss_notification"
                            label="Dismiss notification"
                          />
                        </div>
                      </article>
                    ))}
                </section>
                {data.watches.some((w) =>
                  w.matches.some((m) =>
                    ["available", "notified"].includes(m.status),
                  ),
                ) && (
                  <section aria-label="Recent openings">
                    <h2>Recent openings</h2>
                    <div className="opening-grid">
                      {data.watches.flatMap((w) =>
                        w.matches
                          .filter((m) =>
                            ["available", "notified"].includes(m.status),
                          )
                          .slice(0, 3)
                          .map((m) => (
                            <article className="account-card" key={m.id}>
                              <MatchOverview watch={w} match={m} />
                              <Link href={`/openings/${w.id}`}>
                                View opening
                              </Link>
                            </article>
                          )),
                      )}
                    </div>
                  </section>
                )}
                <h2>Current watches</h2>
                {!current.length && <p>No active watches.</p>}
                <div className="opening-grid">
                  {current.map((w) => (
                    <WatchCard key={w.id} watch={w} />
                  ))}
                </div>
                {past.length > 0 && (
                  <>
                    <h2>Past watches</h2>
                    <div className="opening-grid">
                      {past.map((w) => (
                        <WatchCard key={w.id} watch={w} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
        {process.env.NODE_ENV === "development" &&
          process.env.PAWPORT_ENABLE_MOCK_SCHEDULING === "true" &&
          process.env.VERCEL_ENV !== "production" && (
            <Link className="button secondary" href="/openings/demo">
              Explore demo availability
            </Link>
          )}
      </main>
    </AppFrame>
  );
}
