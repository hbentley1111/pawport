// Edge/worker-only. Never import this module into client components.
export const capabilities = [
  "scheduling.catalog.read",
  "scheduling.availability.read",
  "scheduling.appointment.read",
  "scheduling.appointment.book",
  "scheduling.appointment.cancel",
  "partner.health.readiness",
  "webhook.receive",
] as const;
export type Capability = (typeof capabilities)[number];
export type Environment = "sandbox" | "production";
export type PartnerCredentials = Readonly<
  | { kind: "api_key"; apiKey: string }
  | { kind: "oauth_client"; clientId: string; clientSecret: string }
>;
export interface PartnerCredentialResolver {
  resolve(reference: string): PartnerCredentials;
}
export class EnvironmentCredentialResolver implements PartnerCredentialResolver {
  constructor(private read: (key: string) => string | undefined) {}
  resolve(reference: string): PartnerCredentials {
    if (
      typeof window !== "undefined" ||
      !/^PARTNER_[A-Z0-9_]{1,100}$/.test(reference)
    )
      throw Error("credentials_missing");
    const raw = this.read("PAWPORT_PARTNER_" + reference + "_CREDENTIALS");
    if (!raw || raw.length > 16384) throw Error("credentials_missing");
    try {
      const v = JSON.parse(raw);
      if (
        v &&
        v.kind === "api_key" &&
        Object.keys(v).sort().join(",") === "apiKey,kind" &&
        typeof v.apiKey === "string" &&
        v.apiKey.length > 0 &&
        v.apiKey.length <= 4096
      )
        return Object.freeze({ kind: "api_key", apiKey: v.apiKey });
      if (
        v &&
        v.kind === "oauth_client" &&
        Object.keys(v).sort().join(",") === "clientId,clientSecret,kind" &&
        typeof v.clientId === "string" &&
        v.clientId.length > 0 &&
        v.clientId.length <= 1024 &&
        typeof v.clientSecret === "string" &&
        v.clientSecret.length > 0 &&
        v.clientSecret.length <= 4096
      )
        return Object.freeze({
          kind: "oauth_client",
          clientId: v.clientId,
          clientSecret: v.clientSecret,
        });
    } catch {}
    throw Error("credentials_missing");
  }
}
export interface PartnerAdapter {
  readonly key: string;
  readonly supportedCapabilities: readonly Capability[];
  validateConnection(context: {
    environment: Environment;
    credentials: PartnerCredentials;
  }): Promise<{ success: boolean }>;
  healthCheck(): Promise<"healthy" | "degraded">;
}
export interface PartnerWebhookAdapter {
  readonly partnerKey: string;
  verifyRequest(request: Request, body: Uint8Array): Promise<boolean>;
  eventId(body: Uint8Array): string;
  eventType(body: Uint8Array): string;
  normalize(body: Uint8Array): { eventType: string; externalEventId: string };
}
// No commercial adapters or webhook verifiers registered. Existing ezyVet is separate.
export function registeredPartnerAdapter(_key: string): PartnerAdapter | null {
  void _key;
  return null;
}
export function registeredWebhookAdapter(
  _key: string,
): PartnerWebhookAdapter | null {
  void _key;
  return null;
}
export const ezyvetReadiness = {
  key: "ezyvet",
  adapterRegistered: false,
  existingSchedulingStack: true,
  reschedulingSupported: false,
} as const;
export type RuntimeContext = {
  connectionId: string;
  partnerKey: string;
  environment: Environment;
  credentialRef: string | null;
  contractValid: boolean;
  capabilities: Capability[];
};
export async function validatePartnerContext(
  context: RuntimeContext,
  resolver: PartnerCredentialResolver,
  lookup = registeredPartnerAdapter,
) {
  let configured = false;
  let credentials: PartnerCredentials | undefined;
  try {
    if (context.credentialRef) {
      credentials = resolver.resolve(context.credentialRef);
      configured = true;
    }
  } catch {}
  const adapter = lookup(context.partnerKey);
  if (!adapter)
    return { configured, success: false, error: "unsupported" as const };
  if (!configured || !credentials)
    return {
      configured: false,
      success: false,
      error: "credentials_missing" as const,
    };
  if (
    !context.contractValid ||
    !context.capabilities.length ||
    context.capabilities.some((k) => !adapter.supportedCapabilities.includes(k))
  )
    return {
      configured,
      success: false,
      error: "invalid_configuration" as const,
    };
  // No production endpoint validation/execution is permitted in Phase 10A.
  if (context.environment !== "sandbox")
    return { configured, success: false, error: "unavailable" as const };
  try {
    const result = await adapter.validateConnection({
      environment: context.environment,
      credentials,
    });
    return {
      configured,
      success: result.success,
      error: result.success ? null : ("unavailable" as const),
    };
  } catch {
    return { configured, success: false, error: "unavailable" as const };
  }
}
export async function requirePartnerExecution(
  context: RuntimeContext,
  capability: Capability,
  authorize: () => Promise<boolean>,
  read: (key: string) => string | undefined,
): Promise<PartnerAdapter> {
  if (
    context.environment !== "sandbox" ||
    read("PAWPORT_PARTNER_SANDBOX_ENABLED") !== "true"
  )
    throw Error("unavailable");
  const adapter = registeredPartnerAdapter(context.partnerKey);
  if (!adapter || !adapter.supportedCapabilities.includes(capability))
    throw Error("unsupported");
  if (!(await authorize())) throw Error("unauthorized");
  return adapter;
}
// Strict allowlist discards headers, bodies, URL queries, credentials and arbitrary errors.
export function safePartnerLog(input: Record<string, unknown>) {
  const result: Record<string, string | number> = {};
  for (const key of [
    "partnerKey",
    "connectionId",
    "capability",
    "correlationId",
    "method",
    "endpoint",
    "status",
    "durationMs",
    "errorCode",
  ]) {
    const v = input[key];
    if (["status", "durationMs"].includes(key)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600000)
        result[key] = v;
      continue;
    }
    if (typeof v !== "string") continue;
    const allowed =
      key === "partnerKey"
        ? /^[a-z0-9_]{1,80}$/
        : ["connectionId", "correlationId"].includes(key)
          ? /^[0-9a-f-]{36}$/
          : key === "method"
            ? /^(GET|POST|PATCH|DELETE)$/
            : key === "endpoint"
              ? /^(validation|catalog|availability|appointment_read|appointment_book|appointment_cancel|webhook)$/
              : key === "errorCode"
                ? /^(unauthorized|rate_limited|unavailable|unsupported|invalid_configuration|vendor_error|unknown)$/
                : /^(scheduling\.(catalog\.read|availability\.read|appointment\.(read|book|cancel))|partner\.health\.readiness|webhook\.receive)$/;
    if (allowed.test(v)) result[key] = v;
  }
  return result;
}
