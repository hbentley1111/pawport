import Link from "next/link";
import { z } from "zod";
import { AppFrame } from "@/components/app-frame";
import { careContext } from "@/lib/care/data";
import { notifications } from "@/lib/notifications/data";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
} from "@/lib/timeline/data";
import { NotificationAction } from "@/components/notifications/actions";
import { NotificationList } from "@/components/notifications/list";
export const dynamic = "force-dynamic";
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; cursor?: string }>;
}) {
  const { db } = await careContext(),
    q = await searchParams,
    unread = q.view === "unread";
  let cursor = null,
    bad = false;
  try {
    cursor = decodeTimelineCursor(q.cursor);
    if (cursor && !z.uuid().safeParse(cursor.id).success) bad = true;
  } catch {
    bad = true;
  }
  const page = bad ? null : await notifications(db, unread, cursor);
  return (
    <AppFrame>
      <main className="care-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">YOUR PETTHREAD UPDATES</p>
            <h1>Notifications</h1>
            <p className="muted">
              What PetThread has told you, all in one place.
            </p>
          </div>
          <NotificationAction action="all">Mark all read</NotificationAction>
        </header>
        <nav className="care-view-tabs" aria-label="Notification filter">
          <Link
            href="/notifications"
            aria-current={!unread ? "page" : undefined}
          >
            All
          </Link>
          <Link
            href="/notifications?view=unread"
            aria-current={unread ? "page" : undefined}
          >
            Unread
          </Link>
        </nav>
        {page === null ? (
          <p role="status">
            {bad
              ? "This page link is invalid."
              : "Notifications are temporarily unavailable."}{" "}
            <Link href="/notifications">Start again</Link>
          </p>
        ) : page.notifications.length ? (
          <NotificationList items={page.notifications} />
        ) : (
          <p className="muted">
            {unread ? "No unread notifications." : "No notifications yet."}
          </p>
        )}
        {page?.nextCursor && (
          <Link
            className="button secondary"
            href={`/notifications?${new URLSearchParams({ view: unread ? "unread" : "all", cursor: encodeTimelineCursor(page.nextCursor) })}`}
          >
            Load more
          </Link>
        )}
        {cursor && (
          <p>
            <Link href={`/notifications${unread ? "?view=unread" : ""}`}>
              Back to latest
            </Link>
          </p>
        )}
      </main>
    </AppFrame>
  );
}
