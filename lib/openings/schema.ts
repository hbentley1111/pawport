import { z } from "zod";
import { careTypes } from "@/lib/care/schema";
import { validTimeZone } from "@/lib/care/time";
import type { SchedulingSystem } from "@/lib/care/scheduling-adapter";
const id = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\u0000-\u001f]+$/);
const instant = z.iso.datetime({ offset: true });
export const availabilitySlotSchema = z
  .object({
    externalSlotId: id,
    connectionId: z.uuid(),
    startsAt: instant,
    endsAt: instant,
    appointmentType: z.enum(careTypes),
    externalServiceId: id.optional(),
    externalStaffId: id.optional(),
    externalResourceId: id.optional(),
    bookable: z.boolean(),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt));
const date = z.iso.date();
const time = z.union([
  z.literal(""),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
]);
export const watchInput = z
  .object({
    earliest_date: date,
    latest_date: date,
    earliest_time: time,
    latest_time: time,
    time_zone: z.string().max(100).refine(validTimeZone),
    allowed_weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .strict()
  .refine(
    (v) => v.latest_date >= v.earliest_date,
    "End date must follow start date",
  )
  .refine(
    (v) =>
      !v.earliest_time || !v.latest_time || v.latest_time >= v.earliest_time,
    "End time must follow start time",
  );
export type WatchConstraints = {
  connection_id: string;
  appointment_type: (typeof careTypes)[number] | null;
  external_service_id?: string | null;
  external_staff_id?: string | null;
  earliest_date: string;
  latest_date: string;
  earliest_time: string | null;
  latest_time: string | null;
  allowed_weekdays: number[] | null;
  current_appointment_start: string | null;
  time_zone: string;
  expires_at: string;
};
export type WatchStatus =
  | "active"
  | "matched"
  | "paused"
  | "expired"
  | "cancelled"
  | "connection_unavailable";
export type WorkerWatch = WatchConstraints & {
  id: string;
  process_token: string;
  system: SchedulingSystem;
  status: WatchStatus;
};
export type OpeningMatch = {
  id: string;
  starts_at: string;
  ends_at: string;
  last_seen_at: string;
  status:
    | "available"
    | "notified"
    | "dismissed"
    | "unavailable"
    | "booked"
    | "expired";
};
export type WatchSummary = Omit<
  WatchConstraints,
  "connection_id" | "external_service_id" | "external_staff_id"
> & {
  id: string;
  pet_id: string;
  pet_name: string;
  appointment_id: string | null;
  provider_name: string;
  system: SchedulingSystem;
  google_place_id: string | null;
  status: WatchStatus;
  last_checked_at: string | null;
  last_match_at: string | null;
  matches: OpeningMatch[];
};
export type OpeningNotification = {
  id: string;
  title: string;
  body: string;
  action_url: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  system: SchedulingSystem;
};
export type WatchContext = {
  appointment_id: string;
  pet_id: string;
  connection_id: string;
  system: SchedulingSystem;
  provider_name: string;
  title: string;
  starts_at: string;
};
export const watchStatusLabel = (status: WatchStatus) =>
  ({
    active: "Watching",
    matched: "Opening found",
    paused: "Paused",
    expired: "Expired",
    cancelled: "Cancelled",
    connection_unavailable: "Connection unavailable",
  })[status];
