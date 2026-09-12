import { actionSchema, type Action } from "./pipeline.ts";
import { BookingError } from "./contract.ts";
export function createHandler(options: {
  origins: string[];
  authenticate: (jwt: string) => Promise<string>;
  run: (user: string, action: Action) => Promise<unknown>;
  enabled: () => void;
}) {
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (!origin || !options.origins.includes(origin))
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 403,
        headers,
      });
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 405,
        headers,
      });
    try {
      options.enabled();
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ") || authorization.length > 16000)
        throw new BookingError("unauthorized");
      const user = await options.authenticate(authorization.slice(7));
      const reader = request.body?.getReader();
      let body = "";
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          body += decoder.decode(part.value, { stream: true });
          if (body.length > 8192) {
            await reader.cancel();
            throw new BookingError("unavailable");
          }
        }
      }
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new BookingError("unavailable");
      }
      const parsed = actionSchema.safeParse(raw);
      if (!parsed.success) throw new BookingError("unavailable");
      return new Response(
        JSON.stringify(await options.run(user, parsed.data)),
        { status: 200, headers },
      );
    } catch (error) {
      const code = error instanceof BookingError ? error.code : "unavailable";
      return new Response(JSON.stringify({ error: code }), {
        status:
          code === "unauthorized" ? 401 : code === "rate_limited" ? 429 : 409,
        headers,
      });
    }
  };
}
