import { z } from "zod";
import { BookingError } from "./contract.ts";
export const credentialsSchema = z
  .object({
    partner_id: z.string().min(1).max(255),
    client_id: z.string().min(1).max(255),
    client_secret: z.string().min(1).max(4096),
    grant_type: z.literal("client_credentials").default("client_credentials"),
    scope: z.string().min(1).max(2048),
    site_uid: z.string().regex(/^site_[A-Za-z0-9]{1,100}$/),
  })
  .strict();
export type EzyVetCredentials = z.infer<typeof credentialsSchema>;
export function resolveEzyVetCredentials(
  reference: string,
  read: (key: string) => string | undefined,
): EzyVetCredentials {
  if (!/^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$/.test(reference))
    throw new BookingError("unavailable");
  try {
    const raw = read(reference);
    if (!raw || raw.length > 10000) throw new Error();
    return credentialsSchema.parse(JSON.parse(raw));
  } catch {
    throw new BookingError("unavailable");
  }
}
export function assertSandboxRuntime(
  read: (key: string) => string | undefined,
) {
  if (
    read("PAWPORT_SCHEDULING_ENV") !== "sandbox" ||
    read("PAWPORT_EZYVET_SANDBOX_ENABLED") !== "true"
  )
    throw new BookingError("unavailable");
}
