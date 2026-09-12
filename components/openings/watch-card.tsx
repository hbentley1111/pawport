import Link from "next/link";
import type { WatchSummary } from "@/lib/openings/schema";
import { OpeningAction } from "./actions";
import { WatchOverview, MatchOverview } from "./presentation";
export function WatchCard({
  watch: w,
  detail = false,
}: {
  watch: WatchSummary;
  detail?: boolean;
}) {
  return (
    <section className="account-card opening-card">
      <WatchOverview watch={w} />
      <div className="opening-actions">
        <Link href={`/openings/${w.id}`} className="document-link">
          {detail ? "Watch details" : "View watch"}
        </Link>
        {!["expired", "cancelled"].includes(w.status) && (
          <>
            <Link
              href={`/openings/${w.id}?edit=1`}
              className="button secondary"
            >
              Edit
            </Link>
            <OpeningAction
              id={w.id}
              action={w.status === "paused" ? "active" : "paused"}
              label={w.status === "paused" ? "Resume" : "Pause"}
            />
            <OpeningAction id={w.id} action="cancelled" label="Cancel watch" />
          </>
        )}
      </div>
      {detail && (
        <>
          <h2>Recent matches</h2>
          {!w.matches.length && <p>No matching openings found yet.</p>}
          {w.matches.map((m) => (
            <article className="opening-match" key={m.id}>
              <MatchOverview watch={w} match={m} />
              <div className="opening-actions">
                {w.google_place_id ? (
                  <Link
                    href={`/services/${encodeURIComponent(w.google_place_id)}`}
                    className="button secondary"
                  >
                    Check availability
                  </Link>
                ) : (
                  <Link href="/connections" className="button secondary">
                    View provider connection
                  </Link>
                )}
                {m.status !== "dismissed" && (
                  <OpeningAction
                    id={m.id}
                    action="dismiss_match"
                    label="Dismiss opening"
                  />
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
