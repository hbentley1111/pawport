import Link from "next/link";
import { MapPin, ArrowUpRight } from "lucide-react";
import {
  servicePath,
  type Place,
  type CommunityRating,
} from "@/lib/services/schema";
import {
  GoogleAttribution,
  GoogleRating,
  CommunityRatingDisplay,
  ThirdPartyAttributions,
} from "./ratings";
import { FavoriteButton } from "./forms";
export function PlaceCard({
  place,
  rating,
  saved,
}: {
  place: Place;
  rating: CommunityRating | null | undefined;
  saved: boolean;
}) {
  return (
    <article className="service-card">
      <div className="google-place">
        <GoogleAttribution />
        <div className="service-card-heading">
          <span className="service-place-icon">
            <MapPin size={25} />
          </span>
          <div>
            <p className="service-category">{place.category}</p>
            <h2>
              <Link prefetch={false} href={servicePath(place.id)}>
                {place.name}
              </Link>
            </h2>
          </div>
        </div>
        <GoogleRating place={place} />
        <p className="service-address">
          {place.address || "Service-area business · Ask about coverage"}
        </p>
        <div className="service-location-meta">
          <span>
            {place.distanceMiles !== null
              ? `${place.distanceMiles.toFixed(1)} miles away`
              : "Distance unavailable"}
          </span>
          <span className={place.openNow ? "open-now" : ""}>
            {place.businessStatus === "CLOSED_PERMANENTLY"
              ? "Permanently closed"
              : place.businessStatus === "CLOSED_TEMPORARILY"
                ? "Temporarily closed"
                : place.openNow === null
                  ? "Hours unavailable"
                  : place.openNow
                    ? "Open now"
                    : "Closed now"}
          </span>
        </div>
        <ThirdPartyAttributions place={place} />
      </div>
      <CommunityRatingDisplay rating={rating} />
      <footer>
        <Link
          className="document-link"
          prefetch={false}
          href={servicePath(place.id)}
        >
          View details <ArrowUpRight size={16} />
        </Link>
        <FavoriteButton
          key={`${place.id}:${saved}`}
          placeId={place.id}
          saved={saved}
        />
      </footer>
    </article>
  );
}
