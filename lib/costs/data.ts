import "server-only";
import type { createClient } from "@/lib/supabase/server";
export async function costRpc<T>(
  db: Awaited<ReturnType<typeof createClient>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Error("Cost information is unavailable.");
  return data as T;
}
export async function selectedYear(raw: string | undefined) {
  const year = raw == null ? new Date().getFullYear() : Number(raw);
  if (!Number.isInteger(year) || year < 2000 || year > 2200)
    throw Error("Choose a year from 2000 to 2200.");
  return year;
}
