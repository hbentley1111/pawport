"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, configured } from "@/lib/supabase/server";
import {
  authSchema,
  householdSchema,
  petSchema,
  vaccinationSchema,
  shareSchema,
} from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { z } from "zod";
const fields = (form: FormData) => Object.fromEntries(form.entries());
function origin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("Configure an HTTPS app URL.");
  return url.origin;
}
async function authenticated() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  return { db, user };
}
export async function signUp(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!configured())
    return {
      error:
        "Connect your Supabase project to create an account. See the README for setup.",
    };
  const parsed = authSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = await createClient();
  const { data, error } = await db.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin()}/auth/confirm` },
  });
  if (error)
    return {
      error: "Unable to create an account. Please try again or sign in.",
    };
  if (data.session) redirect("/onboarding");
  return {
    success:
      "Check your email to confirm your account, then sign in. If you already have an account, sign in below.",
  };
}
export async function signIn(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!configured())
    return {
      error:
        "Connect your Supabase project to sign in. See the README for setup.",
    };
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1).max(128) })
    .safeParse(fields(form));
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error)
    return {
      error:
        "Unable to sign in. Check your credentials and confirm your email.",
    };
  redirect("/");
}
export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  redirect("/login");
}
export async function createHousehold(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user } = await authenticated();
  const parsed = householdSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await db
    .from("households")
    .insert({ ...parsed.data, owner_id: user.id });
  if (error)
    return {
      error:
        "Could not create your household. You may already have one; refresh to continue.",
    };
  revalidatePath("/onboarding");
  return { success: "Household created. Let’s meet your pet." };
}
export async function addPet(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user } = await authenticated();
  const parsed = petSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { data: household } = await db
    .from("households")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  if (!household) return { error: "Create a household first." };
  const { error } = await db.from("pets").insert({
    ...parsed.data,
    birth_date: parsed.data.birth_date || null,
    microchip: parsed.data.microchip || null,
    household_id: household.id,
  });
  if (error)
    return {
      error: "Could not add your pet. This MVP supports one pet per household.",
    };
  revalidatePath("/");
  redirect("/");
}
export async function addVaccination(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await authenticated();
  const parsed = vaccinationSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await db
    .from("vaccinations")
    .insert({ ...parsed.data, due_on: parsed.data.due_on || null });
  if (error)
    return { error: "Could not save this vaccination. Please try again." };
  revalidatePath("/");
  revalidatePath("/records");
  return { success: "Vaccination added to the passport." };
}
export async function createShare(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await authenticated();
  const parsed = shareSchema.safeParse(fields(form));
  if (!parsed.success) return { error: "Choose a valid pass duration." };
  const base = origin();
  const { data, error } = await db.rpc("create_share_pass", {
    p_pet_id: parsed.data.pet_id,
    p_hours: Number(parsed.data.hours),
  });
  if (error)
    return {
      error:
        "Could not create a pass. You can have up to five active passes; revoke an existing one and try again.",
    };
  revalidatePath("/");
  return {
    success: "Your private share pass is ready.",
    url: `${base}/share/${data.token}`,
    expiresAt: data.expires_at,
  };
}
export async function revokeShare(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await authenticated();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid pass." };
  const { error } = await db.rpc("revoke_share_pass", { p_pass_id: id.data });
  if (error) return { error: "Could not revoke this pass." };
  revalidatePath("/");
  return { success: "Pass revoked. Its link no longer works." };
}
