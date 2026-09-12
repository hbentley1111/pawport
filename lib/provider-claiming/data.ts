import "server-only";
import { ownerSession } from "@/lib/pet-data";
import { googlePlaces } from "@/lib/services/server";
import { allowServiceRequest } from "@/lib/services/rate-limit";
import type { createClient } from "@/lib/supabase/server";
import type {
  ListingClaimStatus,
  BusinessOrganization,
  ClaimPage,
} from "./schema";
type DB = Awaited<ReturnType<typeof createClient>>;
// ownerSession authenticates without requiring a household; business claimants need no pet.
export const claimantSession = ownerSession;
export async function listingClaimStatus(db: DB, place: string) {
  const r = await db.rpc("service_provider_claim_statuses", {
    p_places: [place],
  });
  if (r.error) return null;
  return (r.data as ListingClaimStatus[])[0] || null;
}
export async function claimantOrganizations(db: DB) {
  const r = await db.rpc("my_service_provider_organizations");
  if (r.error) return null;
  return r.data as BusinessOrganization[];
}
export async function claimantClaims(db: DB, cursor: ClaimPage["nextCursor"]) {
  const r = await db.rpc("my_service_provider_claims", {
    p_before: cursor?.at || null,
    p_before_id: cursor?.id || null,
    p_limit: 25,
  });
  return r.error ? null : (r.data as ClaimPage);
}
export async function confirmClaimPlace(userId: string, place: string) {
  if (!allowServiceRequest(userId, "details"))
    throw new Error("Please wait a few minutes before trying again.");
  return googlePlaces().claimConfirmation(place);
}
