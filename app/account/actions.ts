"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { passwordSchema, profileSchema } from "@/lib/account";
import type { ActionState } from "@/lib/types";
async function account() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  return { db, user };
}
export async function saveProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await account();
  const parsed = profileSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await db.auth.updateUser({ data: parsed.data });
  if (error)
    return { error: "We couldn’t save your details. Please try again." };
  revalidatePath("/account");
  revalidatePath("/");
  return { success: "Your account details have been saved." };
}
export async function changePassword(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user } = await account();
  const parsed = passwordSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!user.email)
    return { error: "Password changes require an email account." };
  // Use the verified session's email, never an email or user ID submitted by the form.
  // A fresh sign-in verifies the old password and satisfies secure-password-change recency.
  const { data, error: authError } = await db.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.current_password,
  });
  if (authError || data.user?.id !== user.id)
    return {
      error:
        "We couldn’t verify your current password. Check it and try again.",
    };
  const { error } = await db.auth.updateUser({
    password: parsed.data.password,
    current_password: parsed.data.current_password,
  });
  if (error) {
    if (error.code === "weak_password")
      return {
        error:
          "Choose a stronger password. It must meet your account’s password requirements.",
      };
    if (error.code === "same_password")
      return { error: "Choose a different password from your current one." };
    return {
      error:
        "We couldn’t change your password. Please try again or sign out and sign back in.",
    };
  }
  revalidatePath("/account");
  return {
    success:
      "Your password has been changed. Use the new password the next time you sign in.",
  };
}
