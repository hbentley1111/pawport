// Pure transport adapter, injected for offline tests. Only server.ts supplies the secret.
import {
  categories,
  coordinatesSchema,
  placeIdSchema,
  searchSchema,
  safeWebUrl,
  type Coordinates,
  type SearchInput,
  type Place,
} from "./schema";
const CARD_FIELDS = [
  "id",
  "displayName",
  "primaryTypeDisplayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "currentOpeningHours.openNow",
  "businessStatus",
  "googleMapsUri",
  "attributions",
  "pureServiceAreaBusiness",
];
export const SEARCH_FIELD_MASK = CARD_FIELDS.map((f) => `places.${f}`).join(
  ",",
);
export const DETAIL_FIELD_MASK = [
  ...CARD_FIELDS.filter(
    (f) => f !== "location" && f !== "currentOpeningHours.openNow",
  ),
  "currentOpeningHours.openNow",
  "currentOpeningHours.weekdayDescriptions",
  "nationalPhoneNumber",
  "websiteUri",
].join(",");
const METERS_PER_MILE = 1609.344,
  EARTH_METERS = 6371008.8;
export class PlacesError extends Error {
  constructor(
    public code:
      "configuration" | "quota" | "unavailable" | "not_found" | "zip_not_found",
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function distanceMiles(a: Coordinates, b: Coordinates) {
  const rad = (n: number) => (n * Math.PI) / 180,
    lat = rad(b.latitude - a.latitude),
    lng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(lng / 2) ** 2;
  return (
    (2 * EARTH_METERS * Math.asin(Math.min(1, Math.sqrt(h)))) / METERS_PER_MILE
  );
}
export function searchRectangle(center: Coordinates, miles: number) {
  const angle = (miles * METERS_PER_MILE) / EARTH_METERS,
    delta = (angle * 180) / Math.PI;
  const lowLat = Math.max(-90, center.latitude - delta),
    highLat = Math.min(90, center.latitude + delta);
  const all = lowLat === -90 || highLat === 90;
  const lng = all
    ? 180
    : (Math.asin(
        Math.min(
          1,
          Math.sin(angle) / Math.cos((center.latitude * Math.PI) / 180),
        ),
      ) *
        180) /
      Math.PI;
  const wrap = (x: number) => ((x + 540) % 360) - 180;
  return {
    low: {
      latitude: lowLat,
      longitude: all ? -180 : wrap(center.longitude - lng),
    },
    high: {
      latitude: highLat,
      longitude: all ? 180 : wrap(center.longitude + lng),
    },
  };
}
type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  formattedAddress?: string;
  location?: Coordinates;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  businessStatus?: string;
  googleMapsUri?: string;
  attributions?: { provider?: string; providerUri?: string }[];
  pureServiceAreaBusiness?: boolean;
  nationalPhoneNumber?: string;
  websiteUri?: string;
};
function normalize(p: GooglePlace, center?: Coordinates): Place | null {
  if (!placeIdSchema.safeParse(p.id).success || !p.displayName?.text)
    return null;
  const coordinates = coordinatesSchema.safeParse(p.location);
  return {
    id: p.id!,
    name: p.displayName.text,
    category: p.primaryTypeDisplayName?.text || "Pet service",
    address: p.formattedAddress || null,
    googleRating:
      typeof p.rating === "number" && p.rating >= 1 && p.rating <= 5
        ? p.rating
        : null,
    googleReviewCount:
      Number.isInteger(p.userRatingCount) && p.userRatingCount! >= 0
        ? p.userRatingCount!
        : 0,
    openNow:
      typeof p.currentOpeningHours?.openNow === "boolean"
        ? p.currentOpeningHours.openNow
        : null,
    businessStatus: p.businessStatus || null,
    distanceMiles:
      center && coordinates.success
        ? distanceMiles(center, coordinates.data)
        : null,
    serviceArea: p.pureServiceAreaBusiness === true,
    mapsUrl:
      safeWebUrl(p.googleMapsUri) ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName.text)}&query_place_id=${encodeURIComponent(p.id!)}`,
    attributions: (p.attributions || [])
      .filter((a) => a.provider)
      .map((a) => ({ name: a.provider!, url: safeWebUrl(a.providerUri) })),
    ...(center
      ? {}
      : {
          hours: p.currentOpeningHours?.weekdayDescriptions || [],
          phone: p.nationalPhoneNumber || null,
          website: safeWebUrl(p.websiteUri),
        }),
  };
}
export function createPlacesClient(
  key: string | undefined,
  request: typeof fetch = fetch,
) {
  async function json(url: string, init: RequestInit = {}) {
    if (!key)
      throw new PlacesError(
        "configuration",
        503,
        "Local services are not configured yet. Add the server-side Google Maps key to enable live discovery.",
      );
    let response: Response;
    try {
      response = await request(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new PlacesError(
        "unavailable",
        502,
        "Google Maps is unavailable right now. Please try again shortly.",
      );
    }
    if (response.status === 429)
      throw new PlacesError(
        "quota",
        429,
        "Local search is busy right now. Please try again in a few minutes.",
      );
    if (response.status === 404)
      throw new PlacesError(
        "not_found",
        404,
        "This business is no longer available on Google Maps.",
      );
    if (!response.ok)
      throw new PlacesError(
        "unavailable",
        502,
        "Google Maps could not complete this request. Please try again later.",
      );
    try {
      return await response.json();
    } catch {
      throw new PlacesError(
        "unavailable",
        502,
        "Google Maps returned an unreadable response. Please try again.",
      );
    }
  }
  function headers(mask: string) {
    return {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key || "",
      "X-Goog-FieldMask": mask,
    };
  }
  async function resolveZip(zip: string): Promise<Coordinates> {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("components", `postal_code:${zip}|country:US`);
    url.searchParams.set("key", key || "");
    const data = await json(url.href);
    if (
      data.status === "OVER_QUERY_LIMIT" ||
      data.status === "OVER_DAILY_LIMIT"
    )
      throw new PlacesError(
        "quota",
        429,
        "Local search is busy right now. Please try again in a few minutes.",
      );
    if (data.status === "ZERO_RESULTS")
      throw new PlacesError(
        "zip_not_found",
        422,
        "We couldn’t find that US ZIP code. Check it and try again.",
      );
    if (data.status !== "OK")
      throw new PlacesError(
        "unavailable",
        502,
        "ZIP lookup is unavailable right now. Try again or use your location.",
      );
    const result = data.results?.find(
      (r: { address_components?: { types: string[]; short_name: string }[] }) =>
        r.address_components?.some(
          (c) => c.types.includes("country") && c.short_name === "US",
        ) &&
        r.address_components?.some(
          (c) => c.types.includes("postal_code") && c.short_name === zip,
        ),
    );
    const point = coordinatesSchema.safeParse({
      latitude: result?.geometry?.location?.lat,
      longitude: result?.geometry?.location?.lng,
    });
    if (!point.success)
      throw new PlacesError(
        "zip_not_found",
        422,
        "We couldn’t find that US ZIP code. Check it and try again.",
      );
    return point.data;
  }
  return {
    async search(raw: SearchInput): Promise<Place[]> {
      const input = searchSchema.parse(raw);
      const center =
        input.location.kind === "zip"
          ? await resolveZip(input.location.zip)
          : input.location.coordinates;
      const category = categories.find((c) => c.id === input.category)!;
      const nearby = "type" in category && input.radius <= 25;
      const body = nearby
        ? {
            includedTypes: [category.type],
            maxResultCount: 20,
            rankPreference: "DISTANCE",
            locationRestriction: {
              circle: { center, radius: input.radius * METERS_PER_MILE },
            },
            languageCode: "en",
          }
        : {
            textQuery: category.query,
            pageSize: 20,
            locationBias: { rectangle: searchRectangle(center, input.radius) },
            languageCode: "en",
            regionCode: "US",
            includePureServiceAreaBusinesses: true,
          };
      const data = await json(
        `https://places.googleapis.com/v1/places:${nearby ? "searchNearby" : "searchText"}`,
        {
          method: "POST",
          headers: headers(SEARCH_FIELD_MASK),
          body: JSON.stringify(body),
        },
      );
      const unique = new Map<string, Place>();
      for (const p of (data.places || []).slice(0, 20)) {
        const place = normalize(p, center);
        if (
          place &&
          !unique.has(place.id) &&
          (place.distanceMiles !== null
            ? place.distanceMiles <= input.radius
            : place.serviceArea)
        )
          unique.set(place.id, place);
      }
      return [...unique.values()].sort(
        (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
      );
    },
    async details(raw: string): Promise<Place> {
      const id = placeIdSchema.parse(raw);
      const data = await json(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en&regionCode=US`,
        { headers: headers(DETAIL_FIELD_MASK) },
      );
      const place = normalize(data);
      if (!place || place.id !== id)
        throw new PlacesError(
          "not_found",
          404,
          "This business is no longer available on Google Maps.",
        );
      return place;
    },
  };
}
