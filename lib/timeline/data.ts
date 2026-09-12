import "server-only";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import type { TimelineCursor, TimelineFilter, TimelinePage } from "./schema";
const cursorSchema = z
  .object({
    at: z
      .string()
      .max(50)
      .refine((v) => Number.isFinite(Date.parse(v))),
    id: z.string().min(1).max(120),
  })
  .strict();
export function decodeTimelineCursor(value?: string): TimelineCursor | null {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid timeline cursor");
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("Invalid timeline cursor");
  }
}
export function encodeTimelineCursor(cursor: TimelineCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export async function petTimeline(
  db: Awaited<ReturnType<typeof createClient>>,
  pet: string,
  filter: TimelineFilter = "all",
  cursor: TimelineCursor | null = null,
  limit = 25,
): Promise<TimelinePage | null> {
  const r = await db.rpc("my_pet_timeline", {
    p_pet: pet,
    p_filter: filter,
    p_before: cursor?.at || null,
    p_before_id: cursor?.id || null,
    p_limit: limit,
  });
  return r.error ? null : (r.data as TimelinePage);
}
