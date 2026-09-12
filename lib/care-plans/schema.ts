import { z } from "zod";
import { localDateTime, validTimeZone, wallTimeToISO } from "../care/time";
export const categories = [
  "medication",
  "heartworm",
  "flea_tick",
  "grooming",
  "nail_trim",
  "dental",
  "wellness",
  "vaccination",
  "supplement",
  "exercise",
  "custom",
] as const;
export const reminderOffsets = [0, 120, 1440, 4320, 10080] as const;
export const reminderText = (n: number) =>
  ({
    0: "When due",
    120: "2 hours before",
    1440: "1 day before",
    4320: "3 days before",
    10080: "1 week before",
  })[n] || "Reminder";
export const categoryText = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return (
      Number.isFinite(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= "1900-01-01" &&
      v <= "2199-12-31"
    );
  }, "Choose a valid calendar date.");
export const planInput = z
  .object({
    title: z.string().trim().min(1, "Give this routine a title.").max(120),
    category: z.enum(categories),
    instructions: z.string().max(1000),
    recurrence_type: z.enum(["one_time", "interval"]),
    interval_value: z.number().int().min(1).max(365).nullable(),
    interval_unit: z.enum(["day", "week", "month"]).nullable(),
    time_zone: z
      .string()
      .min(1)
      .max(100)
      .refine(validTimeZone, "Choose a valid IANA time zone."),
    anchor_local_date: date,
    anchor_local_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .or(z.literal("")),
    ends_on: date.or(z.literal("")),
    reminders: z
      .array(
        z
          .number()
          .refine((n) =>
            reminderOffsets.includes(n as (typeof reminderOffsets)[number]),
          ),
      )
      .max(5),
  })
  .superRefine((v, c) => {
    if (v.ends_on && v.ends_on < v.anchor_local_date)
      c.addIssue({
        code: "custom",
        path: ["ends_on"],
        message: "End date must be on or after the first due date.",
      });
    if (
      v.recurrence_type === "interval" &&
      (!v.interval_value || !v.interval_unit)
    )
      c.addIssue({
        code: "custom",
        message: "Choose how often this routine repeats.",
      });
    if (
      v.recurrence_type === "one_time" &&
      (v.interval_value !== null || v.interval_unit !== null)
    )
      c.addIssue({
        code: "custom",
        message: "One-time routines do not have an interval.",
      });
  });
export type Occurrence = {
  id: string;
  scheduled_for: string;
  snoozed_until: string | null;
  status: "pending" | "completed" | "skipped" | "cancelled";
};
export type CarePlan = Omit<
  z.infer<typeof planInput>,
  "instructions" | "anchor_local_time" | "ends_on"
> & {
  id: string;
  pet_id: string;
  pet_name: string;
  instructions: string | null;
  anchor_local_time: string | null;
  ends_on: string | null;
  status: "active" | "paused" | "archived";
  source: "owner_entered";
  updated_at: string;
  occurrence: Occurrence | null;
};
export type CareHistory = Occurrence & {
  completed_at: string | null;
  skipped_at: string | null;
  completion_note: string | null;
  title_snapshot: string;
  category_snapshot: string;
  time_zone_snapshot: string;
  created_at: string;
};
export type CareNotification = {
  id: string;
  title: string;
  body: string;
  action_url: string;
  created_at: string;
  read_at: string | null;
};
export const effectiveDue = (o: Occurrence) =>
  Date.parse(o.snoozed_until || o.scheduled_for);
export function dueLabel(p: CarePlan, now: number) {
  if (p.status !== "active") return categoryText(p.status);
  const o = p.occurrence;
  if (!o) return "Schedule finished";
  const due = effectiveDue(o),
    today = localDateTime(now, p.time_zone).slice(0, 10),
    day = localDateTime(due, p.time_zone).slice(0, 10);
  const days = Math.round((Date.parse(day) - Date.parse(today)) / 86400000);
  if (
    days < 0 ||
    (days === 0 && !!(p.anchor_local_time || o.snoozed_until) && due < now)
  )
    return "Overdue";
  if (o.snoozed_until) return "Snoozed";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return "Upcoming";
}
export function relevantPlans(
  plans: CarePlan[],
  now: number,
  pet?: string,
  nearTerm = false,
) {
  return plans
    .filter(
      (p) =>
        p.status === "active" &&
        p.occurrence &&
        (!pet || p.pet_id === pet) &&
        (!nearTerm ||
          localDateTime(effectiveDue(p.occurrence), p.time_zone).slice(0, 10) <=
            new Date(
              Date.parse(localDateTime(now, p.time_zone).slice(0, 10)) +
                7 * 86400000,
            )
              .toISOString()
              .slice(0, 10)),
    )
    .sort((a, b) => effectiveDue(a.occurrence!) - effectiveDue(b.occurrence!));
}
export function scheduleLabel(
  p: Pick<CarePlan, "recurrence_type" | "interval_value" | "interval_unit">,
) {
  return p.recurrence_type === "one_time"
    ? "Does not repeat"
    : `Every ${p.interval_value} ${p.interval_unit}${p.interval_value === 1 ? "" : "s"}`;
}
// Snooze presets use local calendar days, never repeated UTC 24-hour increments.
export function snoozePreset(preset: string, zone: string, now = Date.now()) {
  if (preset === "later") return new Date(now + 2 * 3600000).toISOString();
  const days = ({ tomorrow: 1, three: 3, week: 7 } as Record<string, number>)[
    preset
  ];
  if (!days) throw new Error("Choose a snooze time.");
  const local = localDateTime(now, zone);
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return wallTimeToISO(
    `${d.toISOString().slice(0, 10)}T${local.slice(11)}`,
    zone,
    "later",
  );
}
