import Image from "next/image";
import { Star, Heart } from "lucide-react";
import type { CommunityRating, Place } from "@/lib/services/schema";
export function GoogleAttribution() {
  return (
    <div className="google-attribution" translate="no">
      <Image
        src="/google-maps-attribution.svg"
        alt="Google Maps"
        width={98}
        height={18}
        unoptimized
        style={{ height: 18, width: "auto" }}
      />
    </div>
  );
}
export function GoogleRating({ place }: { place: Place }) {
  return (
    <p className="service-rating">
      <Star size={16} fill="currentColor" aria-hidden="true" />
      {place.googleRating !== null ? (
        <>
          <strong>{place.googleRating.toFixed(1)}</strong>
          <span>
            · {place.googleReviewCount.toLocaleString()} Google reviews
          </span>
        </>
      ) : (
        <span>No Google rating yet</span>
      )}
    </p>
  );
}
export function CommunityRatingDisplay({
  rating,
}: {
  rating: CommunityRating | null | undefined;
}) {
  return (
    <div className="community-rating">
      <p className="community-label">
        <Heart size={14} /> PetThread Community
      </p>
      {rating === null ? (
        <p>Community rating unavailable</p>
      ) : rating?.count ? (
        <p>
          <Star size={14} fill="currentColor" />
          <strong>{rating.average?.toFixed(1)}</strong>
          <span>
            · {rating.count} PetThread review{rating.count === 1 ? "" : "s"}
          </span>
        </p>
      ) : (
        <p>Be the first PetThread member to review this business.</p>
      )}
    </div>
  );
}
export function ThirdPartyAttributions({ place }: { place: Place }) {
  return place.attributions.length > 0 ? (
    <p className="provider-attributions">
      {place.attributions.map((a, i) =>
        a.url ? (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
            {a.name}
          </a>
        ) : (
          <span key={i}>{a.name}</span>
        ),
      )}
    </p>
  ) : null;
}
