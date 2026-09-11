"use server";
import { createClient } from "@supabase/supabase-js";
import { configured } from "@/lib/supabase/server";
import {
  completeRecovery,
  recoveryEmailSchema,
  recoveryPasswordSchema,
  recoveryUrl,
} from "@/lib/password-recovery";
import type { ActionState } from "@/lib/types";
function recoveryClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
export async function requestPasswordReset(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = recoveryEmailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  if (!configured())
    return {
      error: "Password recovery is not connected yet. Please try again later.",
    };
  try {
    const redirectTo = recoveryUrl(
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      process.env.NODE_ENV === "production",
    );
    // Uniform response for existing/unknown accounts and provider rate limits.
    await recoveryClient().auth.resetPasswordForEmail(parsed.data, {
      redirectTo,
    });
  } catch {
    return {
      error:
        "Password recovery is temporarily unavailable. Please try again later.",
    };
  }
  return {
    success:
      "If an account exists for this email, you’ll receive a password reset link. Check your inbox and spam folder, and wait a minute before requesting another.",
  };
}
export async function resetPassword(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = recoveryPasswordSchema.safeParse({
    token: form.get("token"),
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!configured())
    return {
      error: "Password recovery is not connected yet. Please try again later.",
    };
  try {
    return await completeRecovery(recoveryClient().auth, parsed.data);
  } catch {
    return {
      error:
        "Password recovery is temporarily unavailable. Please request a new link and try again.",
    };
  }
}
