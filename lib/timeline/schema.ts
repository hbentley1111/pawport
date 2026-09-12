import { z } from "zod";
import { validTimeZone } from "../care/time";
export const journalTypes = [
  "note",
  "milestone",
  "weight",
  "photo",
  "activity",
  "custom",
] as const;
export const timelineFilters = [
  "all",
  "health",
  "care",
  "appointments",
  "life",
] as const;
export type TimelineFilter = (typeof timelineFilters)[number];
export type TimelineCursor = { at: string; id: string };
export type PetTimelineEvent = {
  id: string;
  sourceType: "care" | "appointment" | "vaccination" | "document" | "journal";
  sourceId: string;
  petId: string;
  occurredAt: string;
  eventType: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  trustState: "owner_entered" | "document_supported" | "vet_verified" | null;
  category: "care" | "appointments" | "health" | "life";
  actionUrl: string;
  photoUrl: string | null;
  metadata: {
    careCategory?: string;
    timeZone?: string;
    appointmentType?: string;
    entryType?: string;
    weightValue?: number;
    weightUnit?: "lb" | "kg";
  };
};
export type TimelinePage = {
  events: PetTimelineEvent[];
  nextCursor: TimelineCursor | null;
};
export type JournalEntry = {
  id: string;
  entry_type: (typeof journalTypes)[number];
  title: string | null;
  note: string | null;
  occurred_at: string;
  time_zone: string;
  weight_value: number | null;
  weight_unit: "lb" | "kg" | null;
  photo_id: string | null;
};
export const journalInput = z
  .object({
    entry_type: z.enum(journalTypes),
    title: z.string().trim().max(120),
    note: z.string().trim().max(2000),
    occurred_at: z
      .string()
      .refine(
        (v) =>
          Number.isFinite(Date.parse(v)) &&
          Date.parse(v) >= Date.parse("1900-01-01") &&
          Date.parse(v) <= Date.now() + 300000,
        "Choose a past or present date, no earlier than 1900.",
      ),
    time_zone: z
      .string()
      .max(100)
      .refine(validTimeZone, "Choose a valid IANA time zone."),
    weight_value: z.number().positive().nullable(),
    weight_unit: z.enum(["lb", "kg"]).nullable(),
    photo_id: z.uuid().nullable(),
  })
  .superRefine((v, c) => {
    const error = (message: string) => c.addIssue({ code: "custom", message });
    if (v.entry_type === "weight") {
      if (
        v.weight_value === null ||
        !v.weight_unit ||
        v.weight_value >= (v.weight_unit === "lb" ? 1000 : 453.59237) ||
        Math.abs(v.weight_value * 1000 - Math.round(v.weight_value * 1000)) >
          0.00001
      )
        error(
          "Enter a positive weight below 1000 lb or 453.59237 kg, with up to three decimal places.",
        );
    } else if (v.weight_value !== null || v.weight_unit !== null)
      error("Weight belongs in a weight moment.");
    if (v.entry_type === "photo" ? !v.photo_id : v.photo_id !== null)
      error("Choose a saved photo for a photo moment.");
    if (v.entry_type === "milestone" && !v.title)
      error("Give this milestone a title.");
    if (!["weight", "photo"].includes(v.entry_type) && !v.title && !v.note)
      error("Add a title or note.");
  });
export const timelineTrust = (state: PetTimelineEvent["trustState"]) =>
  state === "vet_verified"
    ? "Vet verified"
    : state === "document_supported"
      ? "Document supported"
      : state === "owner_entered"
        ? "Owner entered"
        : null;
// Preserve the original value/unit; derive kilograms only when a future chart needs them.
export const weightKg = (value: number, unit: "lb" | "kg") =>
  unit === "lb" ? value * 0.45359237 : value;
export function timelineDay(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(Date.parse(instant));
}
