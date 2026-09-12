import Link from "next/link";
import { Building2 } from "lucide-react";
import type { Place } from "@/lib/services/schema";
import {
  GoogleAttribution,
  ThirdPartyAttributions,
} from "@/components/services/ratings";
import {
  claimingTrustCopy,
  claimStatusText,
  type ListingClaimStatus,
  type OwnerClaim,
} from "@/lib/provider-claiming/schema";
export function ListingOwnership({
  placeId,
  status,
}: {
  placeId: string;
  status: ListingClaimStatus | null;
}) {
  return (
    <section className="listing-ownership">
      <Building2 size={24} aria-hidden="true" />
      <div>
        {status === null ? (
          <>
            <h2>Business claiming</h2>
            <p className="muted">
              Claim status is temporarily unavailable. Please try again later.
            </p>
          </>
        ) : status.claimed ? (
          <>
            <h2>Claimed on Pawport</h2>
            <p>This business is managed by a representative on Pawport.</p>
            <p className="fine-print">{claimingTrustCopy}</p>
            <Link className="document-link" href="/help">
              Need help with this listing?
            </Link>
          </>
        ) : !status.claimable ? (
          <>
            <h2>This listing is currently unavailable for claiming.</h2>
            <Link className="document-link" href="/help">
              Need help with this listing?
            </Link>
          </>
        ) : (
          <>
            <h2>Own or manage this business?</h2>
            <p className="muted">
              Request to represent this listing on Pawport.
            </p>
            <Link
              className="button secondary"
              href={`/provider/claim?placeId=${encodeURIComponent(placeId)}`}
            >
              Claim this listing
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
export function ClaimGoogleConfirmation({ place }: { place: Place }) {
  return (
    <section
      className="claim-google-confirmation"
      aria-label="Current Google listing"
    >
      <GoogleAttribution />
      <h2>{place.name}</h2>
      {place.address && <p>{place.address}</p>}
      <Link
        className="document-link"
        href={place.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View on Google Maps
      </Link>
      <ThirdPartyAttributions place={place} />
      <p className="fine-print">
        Confirm this is the location you represent. Google listing information
        is displayed live and is not saved as your Pawport business information.
      </p>
    </section>
  );
}
export function ClaimCard({
  claim: c,
  children,
}: {
  claim: OwnerClaim;
  children?: React.ReactNode;
}) {
  return (
    <article className="claim-card">
      <p className="eyebrow">{claimStatusText[c.status]}</p>
      <h2>{c.organizationName}</h2>
      <p className="muted">
        Submitted{" "}
        <time dateTime={c.createdAt}>
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(Date.parse(c.createdAt))}
        </time>
      </p>
      {c.status === "pending" && (
        <p>
          Your claim is waiting for manual review. Submitting a claim does not
          grant business access.
        </p>
      )}
      {c.status === "approved" &&
        (c.participationActive ? (
          <>
            <p>This business is now claimed on Pawport.</p>
            <p className="muted">Business profile management is coming next.</p>
          </>
        ) : (
          <p>
            Business participation is currently unavailable. Your approved claim
            remains in your history.
          </p>
        ))}
      {c.status === "rejected" && (
        <>
          <p>We couldn’t approve this claim.</p>
          <p className="muted">
            Check your information and contact Pawport support if you believe
            this is an error.
          </p>
          <Link className="document-link" href="/help">
            Get help
          </Link>
        </>
      )}
      {c.status === "withdrawn" && (
        <p>This request has been withdrawn. It will not be reviewed.</p>
      )}
      <Link
        className="document-link"
        href={`/services/${encodeURIComponent(c.googlePlaceId)}`}
      >
        View listing
      </Link>
      {c.status === "approved" && (
        <p className="fine-print">{claimingTrustCopy}</p>
      )}
      {children}
    </article>
  );
}
