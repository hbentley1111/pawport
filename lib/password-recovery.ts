import { z } from "zod";
export const recoveryEmailSchema = z.string().trim().email().max(254);
export const recoveryTokenSchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export const recoveryPasswordSchema = z
  .object({
    token: recoveryTokenSchema,
    password: z.string().min(12, "Use at least 12 characters.").max(128),
    confirm: z.string().max(128),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords must match.",
    path: ["confirm"],
  });
export function recoveryUrl(appUrl: string, production: boolean) {
  const url = new URL(appUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (production && url.protocol !== "https:")
  )
    throw new Error("Invalid app URL");
  return `${url.origin}/auth/reset-password`;
}
type RecoveryAuth = {
  verifyOtp(input: {
    token_hash: string;
    type: "recovery";
  }): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  updateUser(input: { password: string }): Promise<{ error: unknown }>;
  signOut(input: { scope: "local" }): Promise<unknown>;
};
// A separate, non-persistent auth client prevents an ambient login from authorizing recovery.
export async function completeRecovery(
  auth: RecoveryAuth,
  input: z.infer<typeof recoveryPasswordSchema>,
) {
  const parsed = recoveryPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const verified = await auth.verifyOtp({
    token_hash: parsed.data.token,
    type: "recovery",
  });
  if (verified.error || !verified.data.user)
    return {
      error: "This reset link is invalid or expired. Request a new link below.",
    };
  try {
    const updated = await auth.updateUser({ password: parsed.data.password });
    if (updated.error)
      return {
        error:
          "We couldn’t update your password. Request a new link and choose a different password of at least 12 characters.",
      };
    return {
      success:
        "Your password has been reset. You can now sign in with your new password.",
    };
  } finally {
    await auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
