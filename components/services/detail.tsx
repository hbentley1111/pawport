"use client";
import { BusinessResponse } from "@/components/ecosystem/presentation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { MapPin, ArrowUpRight, Phone, Globe, Clock, Star } from "lucide-react";
import type { Place, ReviewPage } from "@/lib/services/schema";
import {
  GoogleAttribution,
  GoogleRating,
  ThirdPartyAttributions,
  CommunityRatingDisplay,
} from "./ratings";
import { FavoriteButton, ReportReview } from "./forms";
import { ReviewText } from "./review-text";
export function PlaceDetails({
  placeId,
  member,
  googleReady,
  saved,
}: {
  placeId: string;
  member: boolean;
  googleReady: boolean;
  saved: boolean;
}) {
  const [place, setPlace] = useState<Place | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!member || !googleReady) return;
    const controller = new AbortController();
    fetch(`/api/services/place/${encodeURIComponent(placeId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || "Business details are unavailable.");
        if (!controller.signal.aborted) setPlace(data.place);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Business details are unavailable.",
          );
      });
    return () => controller.abort();
  }, [placeId, member, googleReady, attempt]);
  return (
    <section className="business-details">
      <Link className="account-back" href="/services">
        ← Discover local care
      </Link>
      {!member ? (
        <div className="service-notice">
          <h1>Local care, with a community perspective.</h1>
          <Link href="/login" className="document-link">
            Sign in to view current business information.
          </Link>
        </div>
      ) : !googleReady ? (
        <div className="service-notice">
          <h1>Business details are not connected yet.</h1>
          <p>Google Maps configuration is needed for live information.</p>
        </div>
      ) : error ? (
        <div className="service-notice" role="alert">
          <h1>We couldn’t load this place.</h1>
          <p>{error}</p>
          <button
            className="button secondary small"
            onClick={() => {
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : !place ? (
        <p className="service-notice" role="status">
          Loading current business information…
        </p>
      ) : (
        <div className="business-google">
          <GoogleAttribution />
          <p className="service-category">{place.category}</p>
          <h1>{place.name}</h1>
          <GoogleRating place={place} />
          <p className="business-address">
            <MapPin size={18} />
            {place.address ||
              "Service-area business · Confirm coverage directly"}
          </p>
          <p className="business-status">
            {place.businessStatus === "CLOSED_PERMANENTLY"
              ? "Permanently closed"
              : place.businessStatus === "CLOSED_TEMPORARILY"
                ? "Temporarily closed"
                : place.openNow === null
                  ? "Current opening status unavailable"
                  : place.openNow
                    ? "Open now"
                    : "Closed now"}
          </p>
          <div className="business-links">
            <a
              className="button"
              href={place.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directions on Google Maps <ArrowUpRight size={16} />
            </a>
            {place.website && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                className="button secondary"
              >
                <Globe size={16} /> Website
              </a>
            )}
            {place.phone && (
              <a
                className="button secondary"
                href={`tel:${place.phone.replace(/[^+\d]/g, "")}`}
              >
                <Phone size={16} />
                {place.phone}
              </a>
            )}
          </div>
          <details className="business-hours">
            <summary>
              <Clock size={16} /> Current hours
            </summary>
            {place.hours?.length ? (
              <ul>
                {place.hours.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p>Hours are not available. Contact the business to confirm.</p>
            )}
          </details>
          <ThirdPartyAttributions place={place} />
          <p className="fine-print">
            Google Maps business information. Confirm services and availability
            directly with the business.
          </p>
        </div>
      )}
      {member && (
        <div className="detail-save">
          <FavoriteButton
            key={`${placeId}:${saved}`}
            placeId={placeId}
            saved={saved}
          />
        </div>
      )}
    </section>
  );
}
export function CommunityReviews({
  placeId,
  initial,
  member,
}: {
  placeId: string;
  initial: ReviewPage | null;
  member: boolean;
}) {
  const [page, setPage] = useState<ReviewPage | null>(null),
    [offset, setOffset] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  // Initial (latest) page is server-revalidated after review mutations.
  const visible = page ?? initial;
  async function load(next: number) {
    setPending(true);
    setError("");
    try {
      const r = await fetch(
        `/api/services/community/${encodeURIComponent(placeId)}?offset=${next}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPage(data);
      setOffset(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reviews are unavailable.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="community-section">
      <p className="eyebrow">EXPERIENCES FROM FELLOW PET PEOPLE</p>
      <h2>PetThread Community</h2>
      <p className="muted">
        Independent member experiences, separate from Google Maps reviews.
        Newest first. Withdrawn or moderated reviews are not shown.
      </p>
      <CommunityRatingDisplay rating={visible?.summary ?? null} />
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {visible?.reviews.map((r) => (
        <article className="community-review" key={r.id}>
          <header>
            <span className="member-avatar">P</span>
            <div>
              <strong>PetThread Member</strong>
              <time dateTime={r.created_at}>
                {new Date(r.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
                {r.updated_at !== r.created_at ? " · Edited" : ""}
              </time>
            </div>
            <span
              className="review-stars"
              aria-label={`${r.rating} out of 5 stars`}
            >
              <Star size={15} fill="currentColor" /> {r.rating}
            </span>
          </header>
          {r.comment && <ReviewText comment={r.comment} />}
          {r.response && <BusinessResponse response={r.response} />}
          {member && <ReportReview reviewId={r.id} />}
        </article>
      ))}
      <div className="review-pagination">
        {offset > 0 && (
          <button
            disabled={pending}
            className="button secondary small"
            onClick={() => void load(offset - 20)}
          >
            Previous reviews
          </button>
        )}
        {visible?.hasMore && (
          <button
            disabled={pending}
            className="button secondary small"
            onClick={() => void load(offset + 20)}
          >
            More reviews
          </button>
        )}
      </div>
    </section>
  );
}
