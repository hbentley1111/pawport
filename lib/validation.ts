import { z } from "zod";
export const today = () => new Date().toISOString().slice(0, 10);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a valid date.",
  );
const text = (max: number) =>
  z.string().trim().min(1, "This field is required.").max(max);
export const authSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
export const householdSchema = z.object({ name: text(80) });
export const petSchema = z.object({
  name: text(60),
  species: z.enum(["Dog", "Cat", "Other"]),
  breed: text(80),
  birth_date: z.union([
    date.refine((v) => v <= today(), "Birth date cannot be in the future."),
    z.literal(""),
  ]),
  sex: z.enum(["Female", "Male", "Unknown"]),
  microchip: z
    .string()
    .trim()
    .max(30)
    .regex(/^[a-zA-Z0-9 -]*$/, "Use letters and numbers only."),
});
export const vaccinationSchema = z
  .object({
    pet_id: z.uuid(),
    name: text(100),
    administered_on: date.refine(
      (v) => v <= today(),
      "Administration date cannot be in the future.",
    ),
    due_on: z.union([date, z.literal("")]),
    clinic: text(120),
  })
  .refine((v) => !v.due_on || v.due_on >= v.administered_on, {
    message: "Next due date must be on or after the vaccination date.",
    path: ["due_on"],
  });
export const shareSchema = z.object({
  pet_id: z.uuid(),
  hours: z.enum(["1", "24", "168"]),
});
export function vaccinationStatus(due: string | null, now = today()) {
  if (!due) return "No due date";
  if (due < now) return "Overdue";
  const days = (Date.parse(due) - Date.parse(now)) / 86400000;
  return days <= 30 ? "Due soon" : "Recorded";
}
export function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not recorded";
}
