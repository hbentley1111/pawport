import "server-only";
import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import type { Intake } from "./schema";
export async function requestIntake(location: string): Promise<Intake | null> {
  if (!configured() || !z.uuid().safeParse(location).success) return null;
  const db = await createClient();
  const r = await db.rpc("service_provider_request_intake", {
    p_location: location,
  });
  return r.error ? null : (r.data as Intake | null);
}
