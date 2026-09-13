"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { TodayResult } from "@/lib/today/schema";
import { useLocalZone } from "../care/local-time";
import {
  TodayEmpty,
  TodayItemCard,
  ThisWeek,
  TodayQuickActions,
  type TodayPet,
} from "./presentation";
import { TodayCareActions } from "./care-actions";
import { timelineDay } from "@/lib/timeline/schema";
export function TodayDashboard({
  pets,
  household,
}: {
  pets: TodayPet[];
  household: string;
}) {
  const zone = useLocalZone(),
    [result, setResult] = useState<TodayResult | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/today?${new URLSearchParams({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Today unavailable.");
        if (!controller.signal.aborted) {
          setResult(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Today unavailable.");
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    window.addEventListener("pawport:notifications-updated", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pawport:notifications-updated", refresh);
    };
  }, [refresh]);
  return (
    <main className="care-page today-page">
      <header className="care-heading">
        <div>
          <p className="eyebrow">PAWPORT TODAY · {household}</p>
          <h1>A little peace of mind.</h1>
          <p className="muted">What needs your attention, all in one place.</p>
        </div>
        <Link className="document-link" href="/notifications">
          Notifications
          {result?.unreadNotificationCount
            ? ` (${result.unreadNotificationCount > 9 ? "9+" : result.unreadNotificationCount})`
            : ""}
        </Link>
      </header>
      <div className="today-pet-links" aria-label="Your pets">
        {pets.map((p) => (
          <Link key={p.id} href={`/pets/${p.id}`}>
            {p.name}
          </Link>
        ))}
        <Link href="/pets/new">+ Add pet</Link>
      </div>
      {error ? (
        <p role="status" className="feedback">
          {error}{" "}
          <button className="text-button" onClick={refresh}>
            Try again
          </button>
        </p>
      ) : !result ? (
        <p role="status" className="muted">
          Gathering today’s care…
        </p>
      ) : (
        <>
          <section className="routine-summary">
            <div className="section-heading">
              <h2>Needs attention</h2>
              <Link className="document-link" href="/care">
                View all care
              </Link>
            </div>
            {result.attention.length ? (
              <div className="today-items">
                {result.attention.map((i) => (
                  <TodayItemCard
                    key={i.id}
                    item={i}
                    pet={pets.find((p) => p.id === i.petId)}
                    zone={result.zone}
                  >
                    {i.category === "care" && i.metadata.occurrenceId && (
                      <TodayCareActions id={i.metadata.occurrenceId} />
                    )}
                  </TodayItemCard>
                ))}
              </div>
            ) : (
              <TodayEmpty fresh={!result.hasTrackedData} />
            )}
          </section>
          {result.comingUp.length > 0 && (
            <section className="routine-summary">
              <h2>Coming up</h2>
              <p className="muted">In the next seven days.</p>
              <div className="today-items">
                {result.comingUp.map((i) => (
                  <TodayItemCard
                    key={i.id}
                    item={i}
                    pet={pets.find((p) => p.id === i.petId)}
                    zone={result.zone}
                  />
                ))}
              </div>
              <Link className="document-link" href="/care">
                View all care
              </Link>
            </section>
          )}
          <ThisWeek summary={result.summary} />
          {result.recentActivity.length > 0 && (
            <section className="routine-summary">
              <h2>Recent activity</h2>
              <ul className="today-recent">
                {result.recentActivity.map((e) => (
                  <li key={e.id}>
                    <p className="eyebrow">
                      {e.petName} · {timelineDay(e.occurredAt, zone)}
                    </p>
                    <Link href={e.actionUrl}>{e.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {result?.insuranceRenewals && result.insuranceRenewals.length > 0 && (
        <section className="routine-summary">
          <h2>Recorded renewals</h2>
          {result.insuranceRenewals.map((r) => (
            <article className="routine-card" key={r.id}>
              <h3>
                {r.petName} — {r.title}
              </h3>
              <p>
                {r.date} · {r.sourceLabel}
              </p>
              <Link href={r.actionUrl}>View coverage information</Link>
            </article>
          ))}
        </section>
      )}
      <TodayQuickActions pets={pets} />
    </main>
  );
}
