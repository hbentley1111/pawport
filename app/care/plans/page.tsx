import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { careContext } from "@/lib/care/data";
import { carePlans } from "@/lib/care-plans/data";
import { PlanCard, RoutineEmpty } from "@/components/care-plans/presentation";
import { CareButton } from "@/components/care-plans/actions";
export const dynamic = "force-dynamic";
export default async function Plans({
  searchParams,
}: {
  searchParams: Promise<{ pet?: string; page?: string }>;
}) {
  const { db, pets } = await careContext(),
    params = await searchParams;
  const pet = pets.some((p) => p.id === params.pet) ? params.pet : undefined;
  const page = /^\d{1,4}$/.test(params.page || "")
    ? Math.min(Number(params.page), 2000)
    : 0;
  const loaded = await carePlans(db, pet, undefined, page * 50, 51);
  const plans = loaded?.slice(0, 50) ?? null,
    now = new Date().getTime();
  const groups = [
    [
      "Due now",
      (p: NonNullable<typeof plans>[number]) =>
        p.status === "active" &&
        !!p.occurrence &&
        Date.parse(p.occurrence.snoozed_until || p.occurrence.scheduled_for) <=
          now,
    ],
    [
      "Upcoming",
      (p: NonNullable<typeof plans>[number]) =>
        p.status === "active" &&
        !!p.occurrence &&
        Date.parse(p.occurrence.snoozed_until || p.occurrence.scheduled_for) >
          now,
    ],
    [
      "Finished / history",
      (p: NonNullable<typeof plans>[number]) =>
        p.status === "active" && !p.occurrence,
    ],
    ["Paused", (p: NonNullable<typeof plans>[number]) => p.status === "paused"],
    [
      "Archived / history",
      (p: NonNullable<typeof plans>[number]) => p.status === "archived",
    ],
  ] as const;
  return (
    <AppFrame>
      <main className="care-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">OWNER-ENTERED CARE</p>
            <h1>Their everyday care.</h1>
            <p className="muted">
              Routines you choose. A little help remembering.
            </p>
          </div>
          <Link
            className="button"
            href={`/care/plans/new${pet ? `?pet=${pet}` : ""}`}
          >
            Add care routine
          </Link>
        </header>
        <Link className="document-link" href="/care">
          Back to Care
        </Link>
        <form className="care-filters" action="/care/plans">
          <label className="field">
            <span>Pet</span>
            <select name="pet" defaultValue={pet || ""}>
              <option value="">All pets</option>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">Apply filter</button>
        </form>
        {plans === null ? (
          <p role="status">
            Care routines are temporarily unavailable. Please try again later.
          </p>
        ) : !plans.length ? (
          <RoutineEmpty />
        ) : (
          groups.map(([title, filter]) => {
            const items = plans.filter(filter);
            return items.length ? (
              <section key={title} className="routine-summary">
                <h2>{title}</h2>
                <div className="routine-grid">
                  {items.map((p) => (
                    <div key={p.id}>
                      <PlanCard
                        plan={p}
                        now={now}
                        pet={pets.find((pet) => pet.id === p.pet_id)}
                      />
                      {p.status === "active" && p.occurrence && (
                        <div className="care-page-links">
                          <CareButton id={p.occurrence.id} action="complete">
                            Mark complete
                          </CareButton>
                          <Link
                            className="button secondary"
                            href={`/care/plans/${p.id}#snooze`}
                          >
                            Snooze
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : null;
          })
        )}
        <div className="care-page-links">
          {page > 0 && (
            <Link
              className="button secondary"
              href={`/care/plans?${new URLSearchParams({ pet: pet || "", page: String(page - 1) })}`}
            >
              Previous routines
            </Link>
          )}
          {loaded && loaded.length > 50 && page < 2000 && (
            <Link
              className="button secondary"
              href={`/care/plans?${new URLSearchParams({ pet: pet || "", page: String(page + 1) })}`}
            >
              More routines
            </Link>
          )}
        </div>
      </main>
    </AppFrame>
  );
}
