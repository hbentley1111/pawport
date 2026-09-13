"use client";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import {
  MapPin,
  LocateFixed,
  Search,
  Heart,
  Stethoscope,
  Siren,
  Scissors,
  Footprints,
  House,
  Sun,
  GraduationCap,
  ShoppingBag,
  Bookmark,
} from "lucide-react";
import {
  categories,
  searchSchema,
  type Category,
  type SearchInput,
  type SearchResult,
  type Place,
  type CommunityRating,
} from "@/lib/services/schema";
import { PlaceCard } from "./place-card";
import { AreaPreference, FavoriteButton } from "./forms";
const icons = [
  Stethoscope,
  Siren,
  Scissors,
  Footprints,
  House,
  Sun,
  GraduationCap,
  ShoppingBag,
];
type SavedResult = {
  entries: { placeId: string; place: Place | null }[];
  community: Record<string, CommunityRating> | null;
  hasMore: boolean;
};
export function ServicesSearch({
  member,
  googleReady,
  preference,
  savedIds,
  communityReady,
}: {
  member: boolean;
  googleReady: boolean;
  preference: { postal_code: string; radius_miles: number } | null;
  savedIds: string[];
  communityReady: boolean;
}) {
  const [zip, setZip] = useState(preference?.postal_code || ""),
    [radius, setRadius] = useState(preference?.radius_miles || 10),
    [category, setCategory] = useState<Category>("vets");
  const [result, setResult] = useState<SearchResult | null>(null),
    [savedResult, setSavedResult] = useState<SavedResult | null>(null),
    [view, setView] = useState<"search" | "saved">("search"),
    [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [searched, setSearched] = useState("");
  const sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  function begin() {
    sequence.current++;
    controller.current?.abort();
    controller.current = new AbortController();
    setPending(true);
    setMessage("");
    return sequence.current;
  }
  async function run(location: SearchInput["location"], ticket?: number) {
    const parsed = searchSchema.safeParse({ category, radius, location });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0].message);
      setPending(false);
      return;
    }
    const turn = ticket ?? begin();
    setView("search");
    setResult(null);
    try {
      const response = await fetch("/api/services/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        signal: controller.current?.signal,
      });
      const data = await response.json();
      if (turn !== sequence.current) return;
      if (!response.ok) throw new Error(data.error || "Search is unavailable.");
      setResult(data);
      setSearched(
        `${categories.find((c) => c.id === category)!.label} · within ${radius} miles of ${location.kind === "zip" ? `ZIP ${location.zip}` : "your current location"}`,
      );
    } catch (error) {
      if (turn === sequence.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Search is unavailable. Try again.",
        );
    } finally {
      if (turn === sequence.current) setPending(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setMessage(
        "Location isn’t supported by this browser. You can still search by ZIP.",
      );
      return;
    }
    const ticket = begin();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (ticket !== sequence.current) return;
        void run(
          {
            kind: "device",
            coordinates: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            },
          },
          ticket,
        );
      },
      () => {
        if (ticket !== sequence.current) return;
        setPending(false);
        setMessage(
          "We couldn’t use your location. Enter a ZIP code to keep searching.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }
  async function loadSaved(next = 0) {
    const turn = begin();
    setView("saved");
    setSavedResult(null);
    setOffset(next);
    try {
      const response = await fetch(`/api/services/saved?offset=${next}`, {
        cache: "no-store",
        signal: controller.current?.signal,
      });
      const data = await response.json();
      if (turn !== sequence.current) return;
      if (!response.ok)
        throw new Error(data.error || "Saved places are unavailable.");
      setSavedResult(data);
    } catch (error) {
      if (turn === sequence.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Saved places are unavailable.",
        );
    } finally {
      if (turn === sequence.current) setPending(false);
    }
  }
  const disabled = pending || !member || !googleReady;
  return (
    <>
      <section className="services-hero">
        <div>
          <p className="eyebrow">GOOD PEOPLE. GREAT CARE. CLOSE TO HOME.</p>
          <h1>
            Find trusted pet care
            <br />
            near you<span>.</span>
          </h1>
          <p>
            From everyday walks to life’s unexpected moments.
            <br className="desktop-break" /> Find your people, with a little
            help from the PetThread community.
          </p>
        </div>
        <div className="services-hero-art" aria-hidden="true">
          <MapPin size={58} strokeWidth={1.1} />
          <Heart size={26} strokeWidth={1.2} />
          <span>
            CARE, A LITTLE
            <br />
            CLOSER
          </span>
        </div>
      </section>
      {!googleReady && (
        <div className="service-notice" role="status">
          <strong>Live local discovery is not connected yet.</strong>
          <p>
            This feature needs its Google Maps configuration. Your existing
            PetThread features are available as usual.
          </p>
        </div>
      )}
      {!member && (
        <div className="service-notice">
          <Link className="document-link" href="/login">
            Sign in to find local care, save places, and write PetThread
            reviews.
          </Link>
        </div>
      )}
      {!communityReady && (
        <div className="service-notice" role="status">
          Community features are temporarily unavailable. Google business
          information can still be searched.
        </div>
      )}
      <section
        className="services-search-box"
        aria-label="Search nearby pet services"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run({ kind: "zip", zip });
          }}
        >
          <label className="field">
            <span>Your ZIP code</span>
            <div className="zip-input">
              <MapPin size={18} />
              <input
                aria-label="5-digit ZIP code"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[0-9]{5}"
                maxLength={5}
                placeholder="e.g. 02118"
                required
                disabled={pending}
              />
            </div>
          </label>
          <label className="field">
            <span>Search radius</span>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              disabled={pending}
            >
              {[5, 10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} miles
                </option>
              ))}
            </select>
          </label>
          <button className="button" disabled={disabled}>
            <Search size={17} />
            {pending ? "Finding care…" : "Find care"}
          </button>
          <span className="location-or">or</span>
          <button
            className="button secondary"
            type="button"
            onClick={locate}
            disabled={disabled}
          >
            <LocateFixed size={17} /> Use my location
          </button>
        </form>
        <p className="location-privacy">
          Device location is used only for this search. It is not saved to your
          account.
        </p>
        {member && communityReady && (
          <AreaPreference
            zip={zip}
            radius={radius}
            hasPreference={Boolean(preference)}
          />
        )}
      </section>
      <div
        className="service-categories"
        role="group"
        aria-label="Service category"
      >
        {categories.map((c, i) => {
          const Icon = icons[i];
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              disabled={pending}
              onClick={() => {
                setCategory(c.id);
                setView("search");
                setResult(null);
                setMessage("");
              }}
            >
              <Icon size={19} />
              {c.label}
            </button>
          );
        })}
      </div>
      {category === "emergency" && (
        <p className="emergency-note">
          Call the clinic to confirm emergency availability before traveling.
          Search results and opening hours do not guarantee emergency care.
        </p>
      )}
      <div className="services-results-heading">
        <h2>
          {view === "saved" ? "Your saved places" : "Care around the corner"}
        </h2>
        <div className="services-view-tabs">
          <button
            aria-pressed={view === "search"}
            disabled={pending}
            onClick={() => {
              setView("search");
              setMessage("");
            }}
          >
            Discover
          </button>
          <button
            aria-pressed={view === "saved"}
            disabled={disabled || !communityReady}
            onClick={() => void loadSaved()}
          >
            <Bookmark size={14} /> Saved ({savedIds.length})
          </button>
        </div>
      </div>
      {message && (
        <p role="alert" className="feedback error">
          {message}
        </p>
      )}
      {pending && (
        <div className="services-empty" role="status">
          <Search size={28} />
          <h3>Finding a little more peace of mind…</h3>
        </div>
      )}
      {!pending && view === "search" && result && (
        <>
          <p className="search-context" role="status">
            {searched} · {result.places.length} result
            {result.places.length === 1 ? "" : "s"}
          </p>
          <div className="services-grid">
            {result.places.map((place) => (
              <PlaceCard
                key={place.id}
                place={place}
                rating={
                  result.community === null ? null : result.community[place.id]
                }
                saved={savedIds.includes(place.id)}
              />
            ))}
          </div>
          {result.places.length === 0 && (
            <div className="services-empty">
              <MapPin size={32} />
              <h3>No places found this time.</h3>
              <p>Try another category, a larger radius, or a nearby ZIP.</p>
            </div>
          )}
          <p className="search-explainer">
            Up to 20 Google Maps matches, ordered here by approximate
            straight-line distance. Text searches use your area as a bias;
            physical places outside your radius are excluded. Service-area
            businesses may not have a distance—confirm their coverage. This is
            not an exhaustive directory or a PetThread endorsement.
          </p>
        </>
      )}
      {!pending && view === "saved" && savedResult && (
        <>
          <div className="services-grid">
            {savedResult.entries
              .filter((e) => savedIds.includes(e.placeId))
              .map((entry) =>
                entry.place ? (
                  <PlaceCard
                    key={entry.placeId}
                    place={entry.place}
                    rating={
                      savedResult.community === null
                        ? null
                        : savedResult.community[entry.placeId]
                    }
                    saved
                  />
                ) : (
                  <article
                    className="service-card unavailable-saved"
                    key={entry.placeId}
                  >
                    <h2>Business unavailable</h2>
                    <p>
                      This saved place is no longer available on Google Maps.
                    </p>
                    <FavoriteButton placeId={entry.placeId} saved />
                  </article>
                ),
              )}
          </div>
          {savedIds.length === 0 && (
            <div className="services-empty">
              <Bookmark size={30} />
              <h3>A little list of your favorites.</h3>
              <p>Save a place while you browse to keep its link here.</p>
            </div>
          )}
          <div className="review-pagination">
            {offset > 0 && (
              <button
                className="button secondary"
                onClick={() => void loadSaved(offset - 6)}
              >
                Previous
              </button>
            )}
            {savedResult.hasMore && (
              <button
                className="button secondary"
                onClick={() => void loadSaved(offset + 6)}
              >
                Next saved places
              </button>
            )}
          </div>
        </>
      )}
      {!pending && !message && view === "search" && !result && (
        <div className="services-empty">
          <span className="services-empty-icon">
            <Heart size={29} />
          </span>
          <h3>Their next good thing could be nearby.</h3>
          <p>
            Choose a category and search your area to find care.
            <br />
            Google Maps business details. A separate PetThread community
            perspective.
          </p>
        </div>
      )}
    </>
  );
}
