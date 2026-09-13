import {
  EnvironmentCredentialResolver,
  validatePartnerContext,
  type RuntimeContext,
} from "../_shared/partners/runtime.ts";
const read = (key: string) => Deno.env.get(key);
const base = read("SUPABASE_URL") || "",
  service = read("SUPABASE_SERVICE_ROLE_KEY") || "";
const origins = new Set(
  (read("PAWPORT_PARTNER_ALLOWED_ORIGINS") || "")
    .split(",")
    .filter((v) => /^https?:\/\/[^/]+$/.test(v)),
);
const rpc = async <T>(
  name: "prepare_partner_validation" | "record_partner_validation",
  args: Record<string, unknown>,
): Promise<T> => {
  const r = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: service,
      Authorization: "Bearer " + service,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("unavailable");
  return await r.json();
};
Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json",
    ...(origins.has(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {}),
  };
  const reply = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), { status, headers });
  if (!origins.has(origin)) return reply(403, { error: "unavailable" });
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Headers":
          "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  if (
    request.method !== "POST" ||
    !request.headers.get("Content-Type")?.startsWith("application/json")
  )
    return reply(405, { error: "unavailable" });
  try {
    const token = request.headers.get("Authorization");
    if (!token?.startsWith("Bearer ") || token.length > 8192)
      return reply(401, { error: "unauthorized" });
    const auth = await fetch(base + "/auth/v1/user", {
      headers: { apikey: service, Authorization: token },
      signal: AbortSignal.timeout(10000),
    });
    if (!auth.ok) return reply(401, { error: "unauthorized" });
    const user = await auth.json();
    if (typeof user.id !== "string")
      return reply(401, { error: "unauthorized" });
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: "unavailable" });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      bytes += v.value.length;
      if (bytes > 2048) {
        await reader.cancel();
        return reply(413, { error: "unavailable" });
      }
      chunks.push(v.value);
    }
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    const body = JSON.parse(new TextDecoder().decode(all));
    if (
      Object.keys(body).sort().join(",") !== "action,connectionId" ||
      body.action !== "validate" ||
      !/^[0-9a-f-]{36}$/.test(body.connectionId)
    )
      return reply(400, { error: "unavailable" });
    const context = await rpc<RuntimeContext>("prepare_partner_validation", {
      p_actor: user.id,
      p_connection: body.connectionId,
    });
    const result = await validatePartnerContext(
      context,
      new EnvironmentCredentialResolver(read),
    );
    await rpc("record_partner_validation", {
      p_actor: user.id,
      p_connection: context.connectionId,
      p_reference: context.credentialRef,
      p_configured: result.configured,
      p_success: result.success,
      p_error: result.error,
    });
    return reply(200, {
      success: result.success,
      credentialConfigured: result.configured,
      error: result.error,
    });
  } catch {
    return reply(400, { error: "unavailable" });
  }
});
