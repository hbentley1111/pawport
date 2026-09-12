import { z } from "zod";
import { placeIdSchema } from "../services/schema";
export const claimInput = z
  .object({
    placeId: placeIdSchema,
    requested_organization_id: z.union([z.uuid(), z.literal("")]),
    organization_name: z
      .string()
      .trim()
      .min(1, "Enter your business or organization name.")
      .max(160),
    claimant_role: z
      .string()
      .trim()
      .min(1, "Tell us your role at the business.")
      .max(100),
    business_email: z.email("Enter a valid business email.").max(254),
    claim_note: z.string().trim().max(1500),
  })
  .strict();
export type BusinessOrganization = { id: string; name: string };
export type ListingClaimStatus = {
  googlePlaceId: string;
  claimed: boolean;
  claimable: boolean;
  organizationId: string | null;
  organizationName: string | null;
};
export type OwnerClaim = {
  id: string;
  googlePlaceId: string;
  organizationName: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  claimantRole: string;
  createdAt: string;
  reviewedAt: string | null;
  participationActive: boolean;
};
export type ClaimPage = {
  claims: OwnerClaim[];
  nextCursor: { at: string; id: string } | null;
};
export const claimStatusText = {
  pending: "Pending review",
  approved: "Claim approved",
  rejected: "Claim not approved",
  withdrawn: "Claim withdrawn",
};
export const claimingTrustCopy =
  "Business claiming does not indicate veterinary credential verification or authorize medical-record verification.";
