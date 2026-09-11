import { z } from "zod";
export const profileSchema = z.object({
  full_name: z.string().trim().max(100, "Keep your name under 100 characters."),
  contact_phone: z
    .string()
    .trim()
    .max(30, "Keep your phone number under 30 characters.")
    .refine(
      (v) => !v || (/^[+\d\s().-]+$/.test(v) && /\d/.test(v)),
      "Enter a valid phone number.",
    ),
});
export const passwordSchema = z
  .object({
    current_password: z
      .string()
      .min(1, "Enter your current password.")
      .max(128),
    password: z
      .string()
      .min(12, "Use at least 12 characters for your new password.")
      .max(128),
    confirm_password: z.string().min(1, "Confirm your new password.").max(128),
  })
  .refine((v) => v.password === v.confirm_password, {
    message: "New passwords do not match.",
    path: ["confirm_password"],
  })
  .refine((v) => v.password !== v.current_password, {
    message: "Choose a different password from your current one.",
    path: ["password"],
  });
// User-editable metadata is display information only, never an authorization source.
export function accountProfile(metadata: Record<string, unknown>) {
  return {
    full_name:
      typeof metadata.full_name === "string"
        ? metadata.full_name.slice(0, 100)
        : "",
    contact_phone:
      typeof metadata.contact_phone === "string"
        ? metadata.contact_phone.slice(0, 30)
        : "",
  };
}
