"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null),
    path = usePathname();
  useEffect(() => {
    const controller = new AbortController();
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const r = await fetch("/api/notifications/count", {
            cache: "no-store",
            signal: controller.signal,
          }),
          data = await r.json();
        if (!controller.signal.aborted && id === request)
          setCount(r.ok ? data.count : null);
      } catch {
        if (!controller.signal.aborted && id === request) setCount(null);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pawport:notifications-updated", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pawport:notifications-updated", refresh);
    };
  }, [path]);
  return (
    <Link
      href="/notifications"
      className="notification-bell"
      aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
    >
      <Bell size={21} aria-hidden="true" />
      {count !== null && count > 0 && (
        <span aria-hidden="true">{count > 9 ? "9+" : count}</span>
      )}
    </Link>
  );
}
