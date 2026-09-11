import { z } from "zod";
import { documentSchema } from "./records";
import { petSchema, vaccinationStatus } from "./validation";
import type { Vaccination } from "./types";
export const MAX_PETS = 20;
export const PHOTO_BUCKET = "pet-photos";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const editPetSchema = petSchema.extend({ pet_id: z.uuid() });
export const photoSchema = documentSchema.safeExtend({
  type: z.enum(["image/jpeg", "image/png"], {
    error: "Choose a JPG, JPEG or PNG photo.",
  }),
  size: z
    .number()
    .int()
    .min(1, "Choose a nonempty photo.")
    .max(MAX_PHOTO_BYTES, "Choose a photo no larger than 3 MiB."),
});
export function petSummary(records: Pick<Vaccination, "name" | "due_on">[]) {
  const attention = records.filter((v) =>
    ["Overdue", "Due soon"].includes(vaccinationStatus(v.due_on)),
  ).length;
  const next = [...records]
    .filter((v) => v.due_on)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!))[0];
  return { attention, next };
}
