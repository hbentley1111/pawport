import "server-only";
import type { createClient } from "@/lib/supabase/server";
export async function ecosystemRpc<T>(
  db: Awaited<ReturnType<typeof createClient>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Error("Business community information is unavailable.");
  return data as T;
}
