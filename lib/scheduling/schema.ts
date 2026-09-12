import { z } from "zod";
import { careTypes, careStatuses } from "@/lib/care/schema";
const identifier = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\u0000-\u001f]+$/);
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (v) =>
      Date.parse(v) >= Date.parse("1900-01-01Z") &&
      Date.parse(v) < Date.parse("2200-01-01Z"),
  );
const identity = {
  event_id: identifier,
  external_id: identifier,
  external_pet_id: identifier,
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  replaces_id: identifier.optional(),
};
export const schedulingEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("upsert"),
      title: z.string().trim().min(1).max(120),
      appointment_type: z.enum(careTypes),
      starts_at: instant,
      ends_at: instant.nullable(),
      status: z.enum(careStatuses),
    })
    .strict()
    .refine(
      (v) => !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at),
      "End must follow start",
    ),
  z.object({ ...identity, kind: z.literal("tombstone") }).strict(),
]);
export type ConnectionSummary = {
  label?: string;
  id: string;
  connection_type: string;
  system: string;
  status: "pending" | "active" | "paused" | "error" | "revoked";
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  can_manage: boolean;
};
export type MappingSummary = {
  id: string;
  connection_id: string;
  pet_id: string;
  pet_name: string;
  status: "pending" | "confirmed" | "rejected" | "disconnected";
};
export const statusLabel = (s: ConnectionSummary["status"]) =>
  ({
    pending: "Not connected",
    active: "Connected",
    paused: "Sync paused",
    error: "Needs attention",
    revoked: "Disconnected",
  })[s];
