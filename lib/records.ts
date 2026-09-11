import { z } from "zod";
export const DOCUMENT_BUCKET = "health-documents";
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const documentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(180)
      .regex(
        /^[^/\\\x00-\x1f\x7f]+$/,
        "Use a simple filename without folders.",
      ),
    type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(MAX_DOCUMENT_BYTES, "Choose a document no larger than 3 MB."),
  })
  .refine(
    (v) =>
      ({
        "application/pdf": ["pdf"],
        "image/jpeg": ["jpg", "jpeg"],
        "image/png": ["png"],
      })[v.type].includes(v.name.split(".").pop()?.toLowerCase() || ""),
    "The extension must match the file type.",
  );
// Signature validation is not malware scanning or authenticity verification.
export function matchesDocumentSignature(bytes: Uint8Array, mime: string) {
  if (mime === "application/pdf")
    return [0x25, 0x50, 0x44, 0x46, 0x2d].every((v, i) => bytes[i] === v);
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return false;
}
export type Trust = {
  vaccination_id?: string;
  source?: "owner_entered" | "document_supported";
  verification_status?:
    "owner_entered" | "document_supported" | "provider_verified";
  verified_by?: string | null;
  verified_at?: string | null;
  verifier_id?: string | null;
  document_id?: string | null;
  request_id?: string | null;
  request_status?: string | null;
};
export function trustLabel(trust: Trust) {
  if (
    trust.verification_status === "provider_verified" &&
    trust.verified_by &&
    trust.verified_at
  )
    return "Vet verified";
  if (
    trust.source === "document_supported" ||
    trust.verification_status === "document_supported"
  )
    return "Document supported";
  return "Owner entered";
}
export type HealthDocument = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  uploaded_at: string | null;
};
export type Provider = { id: string; name: string };
export type ProviderRecord = {
  id: string;
  status: "pending" | "verified";
  provider_id: string;
  provider_name: string;
  requested_at: string;
  verified_at: string | null;
  pet_name: string;
  species: string;
  name: string;
  administered_on: string;
  due_on: string | null;
  clinic: string;
  document_id: string | null;
  document_name: string | null;
};
