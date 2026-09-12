"use client";
import Link from "next/link";
import { NotificationAction } from "./actions";
import { useLocalZone } from "../care/local-time";
import type { OwnerNotification } from "@/lib/notifications/schema";
export function NotificationList({ items }: { items: OwnerNotification[] }) {
  const zone = useLocalZone();
  return (
    <div className="notification-list">
      {items.map((n) => (
        <article key={n.id} className="notification-card">
          <div className="section-heading">
            <h2>{n.title}</h2>
            {!n.readAt && <span className="trust-pill">Unread</span>}
          </div>
          {n.petName && <p className="eyebrow">{n.petName}</p>}
          <p>{n.body}</p>
          <p className="muted">
            <time dateTime={n.createdAt}>
              {new Intl.DateTimeFormat("en-US", {
                timeZone: zone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(Date.parse(n.createdAt))}
            </time>
          </p>
          <div className="care-page-links">
            <Link className="document-link" href={n.actionUrl}>
              View details
            </Link>
            {!n.readAt && (
              <NotificationAction id={n.id} action="read">
                Mark read
              </NotificationAction>
            )}
            <NotificationAction id={n.id} action="dismiss">
              Dismiss
            </NotificationAction>
          </div>
        </article>
      ))}
    </div>
  );
}
