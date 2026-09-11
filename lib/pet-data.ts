import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient, configured } from "./supabase/server";
import type { Pet } from "./types";
export async function ownerSession() {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  return { db, user };
}
export async function ownedPet(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, user } = await ownerSession();
  const { data, error } = await db
    .from("pets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Unable to load pet.");
  if (!data) notFound();
  return { db, user, pet: data as Pet };
}
