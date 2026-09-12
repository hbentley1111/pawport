import { createHandler } from "../_shared/live-booking/handler.ts";
import { createPipeline, type Rpc } from "../_shared/live-booking/pipeline.ts";
import {
  assertSandboxRuntime,
  resolveEzyVetCredentials,
} from "../_shared/live-booking/credentials.ts";
import { EzyVetAdapter } from "../_shared/live-booking/ezyvet.ts";
import { BookingError } from "../_shared/live-booking/contract.ts";

// This file runs only in the protected Edge runtime. Never import it into Next.js.
const read = (key: string) => Deno.env.get(key);
const base = read("SUPABASE_URL") || "";
const key = read("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowed = new Set([
  "prepare_connected_context",
  "record_appointment_mutation_validation",
  "begin_connected_cancellation",
  "assert_connected_dispatch",
  "record_connected_vendor_confirmation",
  "complete_connected_cancellation",
  "fail_connected_mutation",
  "lease_connected_reconciliation",
  "reconcile_connected_mutation",
  "prepare_live_availability_context",
  "record_live_connection_validation",
  "store_live_booking_quotes",
  "begin_live_booking",
  "reconfirm_live_booking",
  "record_live_vendor_confirmation",
  "complete_live_booking",
  "fail_live_booking",
  "prepare_live_provider_catalog",
  "prepare_live_intake",
]);
const rpc: Rpc = async <T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> => {
  if (!allowed.has(name) || !key || !base)
    throw new BookingError("unavailable");
  const response = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const safe = [
      "unauthorized",
      "rate_limited",
      "unavailable",
      "slot_gone",
      "invalid_mapping",
      "vendor_error",
      "unknown",
      "unsupported",
      "conflict",
    ] as const;
    throw new BookingError(
      safe.find((c) => error.message === c) || "unavailable",
    );
  }
  return (await response.json()) as T;
};
const adapters = new Map<string, EzyVetAdapter>();
const run = createPipeline(rpc, async (reference) => {
  assertSandboxRuntime(read);
  const credentials = resolveEzyVetCredentials(reference, read);
  // A rotated secret gets a new token cache; neither the digest nor token leaves this process.
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(credentials)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const cacheKey = reference + ":" + digest;
  let adapter = adapters.get(cacheKey);
  if (!adapter) {
    if (adapters.size >= 100) adapters.delete(adapters.keys().next().value!);
    adapter = new EzyVetAdapter(credentials);
    adapters.set(cacheKey, adapter);
  }
  return adapter;
});
Deno.serve(
  createHandler({
    origins: (read("PAWPORT_SCHEDULING_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => /^https?:\/\/[^/]+$/.test(v)),
    enabled: () => assertSandboxRuntime(read),
    run,
    authenticate: async (jwt) => {
      const result = await fetch(base + "/auth/v1/user", {
        headers: { apikey: key, Authorization: "Bearer " + jwt },
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new BookingError("unauthorized");
      const user = await result.json();
      if (typeof user.id !== "string" || !user.email_confirmed_at)
        throw new BookingError("unauthorized");
      return user.id;
    },
  }),
);
