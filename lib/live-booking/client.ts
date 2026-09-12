"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Action } from "../../supabase/functions/_shared/live-booking/pipeline";
let client: ReturnType<typeof createBrowserClient> | undefined;
export async function liveAction<T>(action: Action): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("unavailable");
  client ??= createBrowserClient(url, key);
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("unauthorized");
  const response = await fetch(url + "/functions/v1/scheduling-live-booking", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + data.session.access_token,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(action),
    cache: "no-store",
    signal: AbortSignal.timeout(action.action === "book" ? 90000 : 60000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === "string" ? result.error : "unavailable",
    );
  return result as T;
}
export type Quote = {
  quoteId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  expiresAt: string;
};
export type LiveService = { id: string; name: string; timeZone: string };
export const liveError = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  return code === "invalid_mapping"
    ? "Live booking isn't available for this pet yet."
    : code === "slot_gone"
      ? "That time was just taken. Refresh available times."
      : code === "unknown"
        ? "We couldn't confirm whether the provider completed this booking. Don't try the same time again yet. Contact the provider to verify the booking status."
        : code === "rate_limited"
          ? "Please wait before checking again."
          : code === "unauthorized"
            ? "Sign in to continue."
            : "Live booking is unavailable. You can request an appointment where offered.";
};
