import type { PetTimelineEvent } from "../timeline/schema";
export type PawportTodayItem = {
  id: string;
  petId: string;
  petName: string;
  kind:
    | "care_due"
    | "appointment"
    | "opening"
    | "record_expiration"
    | "verification_result";
  category: "care" | "appointment" | "opening" | "health" | "notification";
  urgency: "overdue" | "today" | "soon" | "info";
  title: string;
  subtitle: string | null;
  dueAt: string | null;
  dateOnly: boolean;
  actionUrl: string;
  sourceType: string;
  trustState: "owner_entered" | "document_supported" | "vet_verified" | null;
  metadata: {
    occurrenceId?: string;
    notificationId?: string;
    timeZone?: string;
    snoozed?: boolean;
    recordDate?: string;
    providerName?: string;
    demo?: boolean;
    checkedAt?: string;
  };
};
export type TodayResult = {
  attention: PawportTodayItem[];
  comingUp: PawportTodayItem[];
  recentActivity: (PetTimelineEvent & { petName: string })[];
  summary: {
    overdueCount: number;
    dueTodayCount: number;
    nextSevenDaysCount: number;
    careThisWeek: number;
    appointmentsThisWeek: number;
    activeOpeningMatches: number;
  };
  hasTrackedData: boolean;
  unreadNotificationCount: number;
  zone: string;
};
export function todayPriority(i: PawportTodayItem) {
  return i.category === "care"
    ? i.urgency === "overdue"
      ? 1
      : 2
    : i.category === "opening"
      ? 3
      : i.category === "appointment"
        ? 4
        : i.category === "notification"
          ? 5
          : 6;
}
export function combineToday(
  base: TodayResult,
  openings: { count: number; items: PawportTodayItem[] },
  unread: number,
  zone: string,
): TodayResult {
  const attention = [
    ...new Map(
      [...base.attention, ...openings.items].map((i) => [i.id, i]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        todayPriority(a) - todayPriority(b) ||
        Date.parse(a.dueAt || "9999-01-01") -
          Date.parse(b.dueAt || "9999-01-01") ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 10);
  const ids = new Set(attention.map((i) => i.id));
  return {
    ...base,
    attention,
    comingUp: base.comingUp.filter((i) => !ids.has(i.id)).slice(0, 10),
    recentActivity: base.recentActivity.slice(0, 5),
    summary: { ...base.summary, activeOpeningMatches: openings.count },
    hasTrackedData: base.hasTrackedData || openings.count > 0,
    unreadNotificationCount: unread,
    zone,
  };
}
