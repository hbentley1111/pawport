import { z } from "zod";
import { placeIdSchema } from "@/lib/services/schema";
import { validTimeZone, wallTimeToISO } from "./time";
export const careTypes = [
  "veterinary",
  "emergency_vet",
  "grooming",
  "boarding",
  "daycare",
  "walker",
  "sitter",
  "training",
  "medication_followup",
  "vaccination",
  "dental",
  "other",
] as const;
export const careStatuses = [
  "scheduled",
  "confirmed",
  "requested",
  "waitlisted",
  "cancelled",
  "completed",
] as const;
export const activeStatuses = [
  "scheduled",
  "confirmed",
  "requested",
  "waitlisted",
];
export const reminderChoices = [10080, 1440, 120] as const;
export const reminderLabel = (minutes: number) =>
  minutes === 10080
    ? "1 week before"
    : minutes === 1440
      ? "24 hours before"
      : "2 hours before";
export const careLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),
      "Remove control characters.",
    );
export const appointmentInput = z
  .object({
    pet_id: z.uuid(),
    title: text(120).min(1, "Add an appointment title."),
    appointment_type: z.enum(careTypes),
    local_start: z.string().max(16),
    local_end: z.string().max(16),
    time_zone: z.string().max(100).refine(validTimeZone, "Invalid time zone."),
    start_occurrence: z.enum(["earlier", "later"]),
    end_occurrence: z.enum(["earlier", "later"]),
    status: z.enum(careStatuses),
    provider_name: text(160),
    location_text: text(300),
    notes: text(2000),
    google_place_id: z.union([z.literal(""), placeIdSchema]),
    reminders: z
      .array(z.union([z.literal(120), z.literal(1440), z.literal(10080)]))
      .max(3)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export function normalizeAppointment(input: unknown) {
  const parsed = appointmentInput.parse(input);
  const starts_at = wallTimeToISO(
    parsed.local_start,
    parsed.time_zone,
    parsed.start_occurrence,
  );
  const ends_at = parsed.local_end
    ? wallTimeToISO(parsed.local_end, parsed.time_zone, parsed.end_occurrence)
    : null;
  if (ends_at && ends_at <= starts_at)
    throw new Error(
      "End time must be after start time. Use an end date for overnight care.",
    );
  return {
    pet: parsed.pet_id,
    reminders: parsed.reminders,
    data: {
      title: parsed.title,
      appointment_type: parsed.appointment_type,
      starts_at,
      ends_at,
      time_zone: parsed.time_zone,
      status: parsed.status,
      provider_name: parsed.provider_name,
      location_text: parsed.location_text,
      notes: parsed.notes,
      google_place_id: parsed.google_place_id,
    },
  };
}
export type Reminder = {
  id: string;
  reminder_minutes: number;
  dismissed_at: string | null;
};
export type Appointment = {
  sync_state?: "current" | "paused" | "disconnected" | "attention" | null;
  id: string;
  pet_id: string;
  source: "manual" | "pawport" | "external";
  booking_origin?: "pawport_live" | null;
  title: string;
  appointment_type: (typeof careTypes)[number];
  starts_at: string;
  ends_at: string | null;
  time_zone: string;
  status: (typeof careStatuses)[number];
  provider_name: string | null;
  location_text: string | null;
  notes?: string | null;
  google_place_id: string | null;
  updated_at: string;
  appointment_reminders: Reminder[];
};
export function upcoming(
  a: Pick<Appointment, "starts_at" | "status">,
  now: number,
) {
  return activeStatuses.includes(a.status) && Date.parse(a.starts_at) >= now;
}
export function reminderState(
  a: Pick<Appointment, "starts_at" | "status">,
  r: Reminder,
  now: number,
) {
  if (!upcoming(a, now)) return "inactive";
  if (r.dismissed_at) return "dismissed";
  return now >= Date.parse(a.starts_at) - r.reminder_minutes * 60000
    ? "due"
    : "pending";
}
export function filterCare(
  items: Appointment[],
  view: "upcoming" | "past",
  now: number,
  pet?: string,
  type?: string,
) {
  return items
    .filter(
      (a) =>
        (!pet || a.pet_id === pet) &&
        (!type || a.appointment_type === type) &&
        (view === "upcoming" ? upcoming(a, now) : !upcoming(a, now)),
    )
    .sort((a, b) =>
      view === "upcoming"
        ? Date.parse(a.starts_at) - Date.parse(b.starts_at)
        : Date.parse(b.starts_at) - Date.parse(a.starts_at),
    );
}
