import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { PetNavigation } from "@/components/pet-navigation";
import {
  TimelineEmpty,
  TimelineList,
} from "@/components/timeline/presentation";
import { ownedPet } from "@/lib/pet-data";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  petTimeline,
} from "@/lib/timeline/data";
import { timelineFilters, type TimelineFilter } from "@/lib/timeline/schema";
export const dynamic = "force-dynamic";
export default async function Timeline({
  params,
  searchParams,
}: {
  params: Promise<{ petId: string }>;
  searchParams: Promise<{ filter?: string; cursor?: string }>;
}) {
  const { petId } = await params,
    { pet, db } = await ownedPet(petId),
    query = await searchParams;
  const filter: TimelineFilter = timelineFilters.includes(
    query.filter as TimelineFilter,
  )
    ? (query.filter as TimelineFilter)
    : "all";
  let cursor = null,
    invalid = false;
  try {
    cursor = decodeTimelineCursor(query.cursor);
  } catch {
    invalid = true;
  }
  const page = invalid ? null : await petTimeline(db, pet.id, filter, cursor);
  const base = `/pets/${pet.id}/timeline`;
  return (
    <AppFrame>
      <main className="care-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">{pet.name}’S STORY</p>
            <h1>Timeline</h1>
            <p className="muted">
              Care, records, and the little moments in between.
            </p>
          </div>
          <Link className="button" href={`${base}/new`}>
            Add moment
          </Link>
        </header>
        <PetNavigation petId={pet.id} active="Timeline" />
        <nav
          className="care-view-tabs timeline-filters"
          aria-label="Timeline filters"
        >
          {timelineFilters.map((f) => (
            <Link
              key={f}
              href={`${base}?filter=${f}`}
              aria-current={filter === f ? "page" : undefined}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Link>
          ))}
        </nav>
        {!page ? (
          <p role="status">
            {invalid
              ? "This timeline page link is invalid."
              : "The timeline is temporarily unavailable."}{" "}
            <Link href={base}>Start again</Link>
          </p>
        ) : page.events.length ? (
          <TimelineList events={page.events} />
        ) : filter === "all" && !cursor ? (
          <TimelineEmpty petId={pet.id} />
        ) : (
          <p className="muted">
            No moments in this part of their story yet.{" "}
            <Link href={base}>View all</Link>
          </p>
        )}
        {page?.nextCursor && (
          <Link
            className="button secondary"
            href={`${base}?${new URLSearchParams({ filter, cursor: encodeTimelineCursor(page.nextCursor) })}`}
          >
            Load more
          </Link>
        )}
        {cursor && (
          <p>
            <Link className="document-link" href={`${base}?filter=${filter}`}>
              Back to latest
            </Link>
          </p>
        )}
      </main>
    </AppFrame>
  );
}
