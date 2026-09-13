import Link from "next/link";
import { ServicesShell } from "@/components/services/shell";
import {
  ClaimGoogleConfirmation,
  ListingOwnership,
} from "@/components/provider-claiming/presentation";
import { ClaimForm } from "@/components/provider-claiming/forms";
import {
  claimantSession,
  claimantOrganizations,
  confirmClaimPlace,
  listingClaimStatus,
} from "@/lib/provider-claiming/data";
import { placeIdSchema } from "@/lib/services/schema";
import { PlacesError } from "@/lib/services/google-client";
export const dynamic = "force-dynamic";
export default async function Claim({
  searchParams,
}: {
  searchParams: Promise<{ placeId?: string }>;
}) {
  const { db, user } = await claimantSession();
  const parsed = placeIdSchema.safeParse((await searchParams).placeId);
  if (!parsed.success)
    return (
      <ServicesShell>
        <h1>Choose a business to claim.</h1>
        <p>Open a listing in Local Services to start your request.</p>
        <Link className="button" href="/services">
          Find a business
        </Link>
        <Link className="document-link" href="/provider/claims">
          My claims
        </Link>
      </ServicesShell>
    );
  const id = parsed.data;
  const [status, organizations] = await Promise.all([
    listingClaimStatus(db, id),
    claimantOrganizations(db),
  ]);
  let place = null,
    error = "";
  if (status?.claimable && organizations !== null) {
    try {
      place = await confirmClaimPlace(user.id, id);
    } catch (e) {
      error =
        e instanceof PlacesError
          ? e.message
          : "Listing confirmation is temporarily unavailable. Please try again later.";
    }
  }
  return (
    <ServicesShell>
      <div className="claim-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">YOUR BUSINESS ON PETTHREAD</p>
            <h1>Claim this listing</h1>
            <p className="muted">
              Let us know who stands behind this business.
            </p>
          </div>
          <Link className="document-link" href="/provider/claims">
            My claims
          </Link>
        </header>
        {!status?.claimable || organizations === null ? (
          <>
            {status?.claimed && (
              <p>This business has already been claimed on PetThread.</p>
            )}
            <ListingOwnership
              placeId={id}
              status={organizations === null ? null : status}
            />
          </>
        ) : place ? (
          <>
            <ClaimGoogleConfirmation place={place} />
            <h2>Your PetThread business information</h2>
            <ClaimForm placeId={id} organizations={organizations} />
          </>
        ) : (
          <p className="feedback" role="status">
            {error || "Listing confirmation is temporarily unavailable."}{" "}
            <Link href={`/provider/claim?placeId=${encodeURIComponent(id)}`}>
              Try again
            </Link>
          </p>
        )}
        <Link
          className="document-link"
          href={`/services/${encodeURIComponent(id)}`}
        >
          Back to listing
        </Link>
      </div>
    </ServicesShell>
  );
}
