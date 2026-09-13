import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlacesClient,
  PlacesError,
  SEARCH_FIELD_MASK,
  DETAIL_FIELD_MASK,
  searchRectangle,
} from "../lib/services/google-client";
import {
  searchSchema,
  placeIdSchema,
  reviewSchema,
  servicePath,
  safeWebUrl,
} from "../lib/services/schema";
import { createServiceLimiter } from "../lib/services/rate-limit";
const gps = {
  kind: "device" as const,
  coordinates: { latitude: 42.35, longitude: -71.06 },
};
const rawPlace = {
  id: "ChIJ_pet-1",
  displayName: { text: "Happy Tails" },
  location: { latitude: 42.351, longitude: -71.061 },
  rating: 4.6,
  userRatingCount: 387,
  currentOpeningHours: { openNow: true },
  attributions: [
    { provider: "Provider", providerUri: "https://example.com/credit" },
  ],
};
function transport(...responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const data = responses.shift();
    if (data instanceof Error) throw data;
    return data instanceof Response ? data : Response.json(data);
  };
  return { calls, request };
}
test("service search validates ZIP, coordinates, category/radius allowlists and rejects injected endpoints/fields", () => {
  assert.ok(
    searchSchema.safeParse({
      category: "vets",
      radius: 10,
      location: { kind: "zip", zip: "02118" },
    }).success,
  );
  assert.ok(
    searchSchema.safeParse({ category: "walkers", radius: 50, location: gps })
      .success,
  );
  for (const zip of ["2118", "02118-1234", "abcde", "123456", " 02118"])
    assert.equal(
      searchSchema.safeParse({
        category: "vets",
        radius: 10,
        location: { kind: "zip", zip },
      }).success,
      false,
    );
  for (const patch of [
    { category: "hospital" },
    { radius: 51 },
    { radius: 0 },
    { radius: "10" },
    { endpoint: "http://localhost" },
    { fieldMask: "*" },
    {
      location: { kind: "device", coordinates: { latitude: 91, longitude: 0 } },
    },
    {
      location: {
        kind: "device",
        coordinates: { latitude: 0, longitude: Infinity },
      },
    },
  ])
    assert.equal(
      searchSchema.safeParse({
        category: "vets",
        radius: 10,
        location: gps,
        ...patch,
      }).success,
      false,
    );
  for (const id of [
    "../secret",
    "https://evil.example",
    "places/abc",
    "a?key=x",
    "%2f",
    "a".repeat(256),
    "",
  ])
    assert.equal(placeIdSchema.safeParse(id).success, false);
  assert.equal(servicePath("ChIJ_pet-1"), "/services/ChIJ_pet-1");
  assert.equal(safeWebUrl("javascript:alert(1)"), null);
  assert.equal(safeWebUrl("https://user:pass@example.com"), null);
});
test("ZIP uses country+postal Geocoding then a single Nearby Search; duplicate IDs are removed", async () => {
  const t = transport(
    {
      status: "OK",
      results: [
        {
          address_components: [
            { types: ["country"], short_name: "US" },
            { types: ["postal_code"], short_name: "02118" },
          ],
          geometry: { location: { lat: 42.35, lng: -71.06 } },
        },
      ],
    },
    {
      places: [
        rawPlace,
        rawPlace,
        { ...rawPlace, id: "far", location: { latitude: 40, longitude: -71 } },
        {
          ...rawPlace,
          id: "mobile",
          location: undefined,
          pureServiceAreaBusiness: true,
        },
      ],
    },
  );
  const results = await createPlacesClient("secret-marker", t.request).search({
    category: "vets",
    radius: 10,
    location: { kind: "zip", zip: "02118" },
  });
  assert.equal(t.calls.length, 2);
  assert.equal(
    new URL(t.calls[0].url).searchParams.get("components"),
    "postal_code:02118|country:US",
  );
  assert.ok(t.calls[1].url.endsWith("places:searchNearby"));
  assert.deepEqual(JSON.parse(t.calls[1].init.body as string).includedTypes, [
    "veterinary_care",
  ]);
  assert.equal(
    new Headers(t.calls[1].init.headers).get("X-Goog-FieldMask"),
    SEARCH_FIELD_MASK,
  );
  assert.deepEqual(
    results.map((p) => p.id),
    ["ChIJ_pet-1", "mobile"],
  );
  assert.ok(results[0].distanceMiles! < 1);
  assert.equal(results[1].distanceMiles, null);
  assert.equal(JSON.stringify(results).includes("secret-marker"), false);
  assert.equal("location" in results[0], false);
  assert.equal("community" in results[0], false);
  for (const call of t.calls) {
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.redirect, "error");
  }
});
test("GPS avoids geocoding; supported categories use Nearby and fallback categories use fixed Text Search queries", async () => {
  for (const [category, endpoint] of [
    ["stores", "searchNearby"],
    ["groomers", "searchText"],
    ["walkers", "searchText"],
    ["sitters", "searchText"],
    ["boarding", "searchText"],
    ["trainers", "searchText"],
    ["emergency", "searchText"],
  ] as const) {
    const t = transport({ places: [] });
    await createPlacesClient("key", t.request).search({
      category,
      radius: 5,
      location: gps,
    });
    assert.equal(t.calls.length, 1);
    assert.ok(t.calls[0].url.endsWith(endpoint));
    const body = JSON.parse(t.calls[0].init.body as string);
    assert.equal(body.pageSize || body.maxResultCount, 20);
    if (endpoint === "searchText") {
      assert.ok(body.locationBias.rectangle);
      assert.equal(body.includePureServiceAreaBusinesses, true);
    }
  }
});
test("50 miles uses a larger rectangular text bias instead of silently capping to 50 km", async () => {
  const t = transport({
    places: [{ ...rawPlace, location: { latitude: 42.95, longitude: -71.06 } }],
  });
  const results = await createPlacesClient("key", t.request).search({
    category: "vets",
    radius: 50,
    location: gps,
  });
  assert.ok(t.calls[0].url.endsWith("searchText"));
  const body = JSON.parse(t.calls[0].init.body as string);
  assert.ok(body.locationBias.rectangle.high.latitude > 43);
  assert.equal(results.length, 1);
  assert.ok(results[0].distanceMiles! > 31);
  const pole = searchRectangle({ latitude: 90, longitude: 179 }, 50);
  assert.equal(pole.high.latitude, 90);
  assert.equal(pole.low.longitude, -180);
  assert.equal(pole.high.longitude, 180);
  const crossed = searchRectangle({ latitude: 0, longitude: 179.9 }, 50);
  assert.ok(crossed.low.longitude > crossed.high.longitude);
});
test("place details request only displayed fields and project away private/unrequested upstream values", async () => {
  const t = transport({
    ...rawPlace,
    nationalPhoneNumber: "555-0100",
    websiteUri: "javascript:alert(1)",
    currentOpeningHours: {
      openNow: true,
      weekdayDescriptions: ["Monday: 9–5"],
    },
    reviews: [{ text: "Do not return Google excerpts" }],
    secret: "hidden",
  });
  const p = await createPlacesClient("key", t.request).details(rawPlace.id);
  assert.equal(
    new Headers(t.calls[0].init.headers).get("X-Goog-FieldMask"),
    DETAIL_FIELD_MASK,
  );
  assert.equal(p.website, null);
  assert.deepEqual(p.hours, ["Monday: 9–5"]);
  assert.equal(JSON.stringify(p).includes("Do not return"), false);
  assert.equal(p.googleRating, 4.6);
  assert.equal(p.googleReviewCount, 387);
  for (const mask of [SEARCH_FIELD_MASK, DETAIL_FIELD_MASK])
    assert.doesNotMatch(mask, /\*|reviews|photos|generativeSummary/);
});
test("Google errors are graceful and never echo upstream diagnostics or keys", async () => {
  for (const [response, code] of [
    [new Response("secret-marker", { status: 429 }), "quota"],
    [new Response("secret-marker", { status: 403 }), "unavailable"],
    [new Response("secret-marker", { status: 404 }), "not_found"],
    [new Error("secret-marker in request URL"), "unavailable"],
  ] as const) {
    const t = transport(response);
    await assert.rejects(
      () => createPlacesClient("secret-marker", t.request).details("valid-ID"),
      (e: unknown) =>
        e instanceof PlacesError &&
        e.code === code &&
        !e.message.includes("secret-marker"),
    );
  }
  await assert.rejects(
    () => createPlacesClient(undefined).details("valid-ID"),
    (e: unknown) => e instanceof PlacesError && e.code === "configuration",
  );
  const malformed = transport(new Response("not json"));
  await assert.rejects(
    () => createPlacesClient("key", malformed.request).details("id"),
    PlacesError,
  );
  for (const status of ["ZERO_RESULTS", "OVER_QUERY_LIMIT", "REQUEST_DENIED"]) {
    const t = transport({ status });
    await assert.rejects(
      () =>
        createPlacesClient("key", t.request).search({
          category: "vets",
          radius: 10,
          location: { kind: "zip", zip: "00000" },
        }),
      PlacesError,
    );
  }
  const missing = transport({});
  await assert.rejects(
    () => createPlacesClient("key", missing.request).details("missing"),
    PlacesError,
  );
});
test("per-member search budget is bounded, separates callers and expires", () => {
  let now = 0;
  const allow = createServiceLimiter(() => now);
  for (let i = 0; i < 20; i++) assert.ok(allow("A", "search"));
  assert.equal(allow("A", "search"), false);
  assert.ok(allow("B", "search"));
  assert.ok(allow("A", "details"));
  now = 300001;
  assert.ok(allow("A", "search"));
});
test("PetThread review validation requires rating and bounds plain text", () => {
  const review = {
    placeId: "valid",
    rating: 5,
    comment: "<script>alert(1)</script>",
  };
  assert.ok(reviewSchema.safeParse(review).success);
  for (const patch of [
    { rating: 0 },
    { rating: 6 },
    { rating: 2.5 },
    { rating: "" },
    { comment: "x".repeat(1501) },
    { user_id: "spoof" },
  ])
    assert.equal(
      reviewSchema.safeParse({ ...review, ...patch }).success,
      false,
    );
});
