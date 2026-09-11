import "server-only";
import { createClient, configured } from "@/lib/supabase/server";
import { PlacesError } from "./google-client";
import { ZodError } from "zod";
import { allowServiceRequest } from "./rate-limit";
export const noStore = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export function serviceJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      ...noStore,
      ...(status === 429 ? { "Retry-After": "300" } : {}),
    },
  });
}
export async function serviceSession(kind: "search" | "details" | "write") {
  if (!configured())
    throw new PlacesError(
      "configuration",
      503,
      "Connect Supabase to use member services.",
    );
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new PlacesError(
      "unavailable",
      401,
      "Sign in to find local care and use community features.",
    );
  if (!allowServiceRequest(user.id, kind))
    throw new PlacesError(
      "quota",
      429,
      "You’ve made several requests. Please try again in a few minutes.",
    );
  return { db };
}
export function serviceError(error: unknown) {
  if (error instanceof PlacesError)
    return serviceJson(
      { error: error.message, code: error.code },
      error.status,
    );
  if (error instanceof ZodError)
    return serviceJson(
      { error: error.issues[0]?.message || "Invalid request." },
      400,
    );
  return serviceJson(
    { error: "This service is temporarily unavailable. Please try again." },
    503,
  );
}
export async function smallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PlacesError("unavailable", 400, "Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      throw new PlacesError("unavailable", 413, "Request too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PlacesError("unavailable", 400, "Invalid request.");
  }
}
