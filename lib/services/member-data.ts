import "server-only";
import { createClient, configured } from "@/lib/supabase/server";
export async function serviceMember() {
  if (!configured()) return { db: null, member: false };
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  return { db, member: !error && Boolean(user) };
}
