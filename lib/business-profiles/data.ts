import "server-only";
import { createClient, configured } from "@/lib/supabase/server";
import { z } from "zod";
import type { PublicProfile, ProfileEditor, Business } from "./schema";
export async function publicProfile(location: string) {
  if (!configured() || !z.uuid().safeParse(location).success) return null;
  const db = await createClient();
  const r = await db.rpc("service_provider_public_profile", {
    p_location: location,
  });
  return r.error ? null : (r.data as PublicProfile | null);
}
export async function profileEditor(
  db: Awaited<ReturnType<typeof createClient>>,
  id: string,
) {
  if (!z.uuid().safeParse(id).success) return null;
  const r = await db.rpc("service_provider_profile_editor", {
    p_organization: id,
  });
  return r.error ? null : (r.data as ProfileEditor);
}
export async function businesses(db: Awaited<ReturnType<typeof createClient>>) {
  const r = await db.rpc("my_service_provider_businesses");
  return r.error ? null : (r.data as Business[]);
}
