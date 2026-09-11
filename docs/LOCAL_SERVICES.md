# Local services and Pawport Community — Phase 4

Implementation branch: `feature/local-services-reviews`. This change does not apply remote migrations, merge to main, or deploy. Use an isolated Supabase staging project for acceptance testing.

## Product and routes

`/services` provides ZIP/device-location search, eight category chips, radius selection, separate Google and Pawport ratings, and a private saved list. `/services/[placeId]` loads current business details and independent Pawport reviews. Services is linked from the household dashboard, single-pet dashboard, per-pet navigation, and Account. No selected pet is required. Existing records, provider verification, photos, and share routes are unchanged.

Discovery requires a signed-in member to bound paid API use. Published community reviews have a public, privacy-safe read projection. Missing Google configuration shows a clear message and disables live search; the rest of Pawport still works. Missing Phase 4 tables produces an unavailable community state rather than fictitious zero ratings.

This release prioritizes a mobile list experience. There is no map, Google photo display, or individual Google review text. A Google map/list toggle is a later enhancement; do not add another mapping provider to display Google Places results.

## Google architecture and current references

Browser requests go to authenticated Pawport endpoints; only the server calls Google. `lib/services/server.ts` is marked `server-only` and supplies `GOOGLE_MAPS_API_KEY` to the injectable transport. No client receives that variable, key, Google request URL containing a key, or raw upstream error. The app uses ordinary API-key authentication, not service accounts.

Required APIs:

- **Geocoding API**, v3 `https://maps.googleapis.com/maps/api/geocode/json`: US ZIP lookup using `components=postal_code:XXXXX|country:US`. Accept only a result with the matching ZIP and US country. Coordinates are request-local. [Geocoding requests](https://developers.google.com/maps/documentation/geocoding/requests-geocoding).
- **Places API (New)**: `POST /v1/places:searchNearby`, `POST /v1/places:searchText`, and `GET /v1/places/{placeId}`. The client cannot select an endpoint or field mask. [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search), [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details).
- **Maps JavaScript API is not needed** because there is no embedded map.

Supported types were checked against Google's current [Place Types list](https://developers.google.com/maps/documentation/places/web-service/place-types) on September 11, 2026. The implementation uses `veterinary_care` and `pet_store` for Nearby Search. Although broader pet-care types exist, fixed Text Search phrases cover the more specific categories without claiming an unsupported type.

| Category      | Method at 5/10/25 miles | Fixed type or text query       |
| ------------- | ----------------------- | ------------------------------ |
| Vets          | Nearby                  | `veterinary_care`              |
| Emergency Vet | Text                    | `emergency veterinarian`       |
| Groomers      | Text                    | `pet groomers`                 |
| Walkers       | Text                    | `dog walkers`                  |
| Sitters       | Text                    | `pet sitters`                  |
| Boarding      | Text                    | `pet boarding and dog daycare` |
| Trainers      | Text                    | `dog trainers`                 |
| Pet Stores    | Nearby                  | `pet_store`                    |

Nearby Search allows circles up to 50,000 meters. **All 50-mile searches use Text Search with a rectangular location bias** covering the requested circle; they are not silently reduced to 50 km. Text Search is biased, not an exhaustive radius directory. Physical results outside the requested radius are excluded using straight-line distance. Mobile/service-area businesses without coordinates can appear with unknown distance; users must confirm coverage. Results are deduplicated by Place ID, sorted by known distance, and limited to 20 with no automatic next-page requests. Emergency availability must be confirmed with the clinic.

### Exact field masks

Search uses this mask for both methods:

```text
places.id,places.displayName,places.primaryTypeDisplayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.businessStatus,places.googleMapsUri,places.attributions,places.pureServiceAreaBusiness
```

Detail uses:

```text
id,displayName,primaryTypeDisplayName,formattedAddress,rating,userRatingCount,businessStatus,googleMapsUri,attributions,pureServiceAreaBusiness,currentOpeningHours.openNow,currentOpeningHours.weekdayDescriptions,nationalPhoneNumber,websiteUri
```

Geocoding v3 does not use a Places field mask; its response is reduced to the matching location in server memory. No wildcard fields, Google review text, photos, generative summaries, or routing fields are requested. Search cards use the search response directly; opening details adds one details request. [Google's field/SKU reference](https://developers.google.com/maps/documentation/places/web-service/data-fields) identifies rating, review count, and current hours as cost-sensitive Enterprise fields. Recheck current billing before launch; these are intentionally requested because the UI displays them.

## Persistence, attribution, and location privacy

Only `google_place_id` is persisted as Google identity. There is no business mirror table. Addresses, coordinates, Google scores/counts/reviews, hours, names, phone numbers, websites and photos are not written to Pawport tables or logs. Google fetches use `cache: "no-store"`; service API responses are private/no-store and pages are dynamic. The browser holds current responses only in component memory, with no localStorage, persistent client query cache, or service-worker cache. Saved places fetch fresh details when the member explicitly opens that list.

This conservative design follows Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) and [Place ID guidance](https://developers.google.com/maps/documentation/places/web-service/place-id). Place IDs may change or become unavailable; a stale favorite shows an unavailable state and can be removed. There is no automatic identifier migration in this MVP.

The official, unmodified dark-gray Google Maps SVG is included as `public/google-maps-attribution.svg`, sourced from Google's [attribution asset package](https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip). It appears inside each Google business section, with accessible “Google Maps” text, 18px height, and required clearspace. Provider attributions returned by Places are rendered with safe links. Pawport ratings/reviews have a separate visual section; neither score is blended or relabeled. Any future photo or individual Google-review feature must add the required author attribution, source links, and applicable ordering notice at implementation time.

GPS is requested only on “Use my location,” sent in the POST body for that active search, and never placed in URLs, analytics, tables, or preferences. Geolocation denial leaves ZIP search usable. The permissions policy permits self geolocation on services pages only. ZIP input is exactly five digits; the default radius is 10 miles, with 5/10/25/50 allowed server-side. Only an explicit “Remember this ZIP & radius” saves the user's entered ZIP and radius. “Forget saved area” deletes the preference. Returned geocoding coordinates are never saved.

Infrastructure operators must keep request-body capture and outgoing Google URL/header capture disabled or redacted in observability products. In particular, the Geocoding request URL contains a key. This code never logs it. Device location is transmitted to Google to perform search; describe this in the product's reviewed privacy policy.

**Before public production launch, Pawport must have publicly accessible Terms of Use and a Privacy Policy appropriate for Google Maps Platform usage, with required references to Google's terms/privacy.** The existing Help link is not a substitute. Have these documents reviewed; this implementation does not invent legal language or assert legal approval. Recheck policies for the billing-account region, including any EEA-specific conditions.

## Migration and database design

Apply `supabase/migrations/202609110004_local_services_reviews.sql` after `001`, `002`, and `003`, initially only in local/staging. It creates four tables and scoped functions; it does not alter any existing pet, household, medical, provider, share, audit, or Storage policy/table. There are no new buckets.

| Table                      | Durable columns and constraints                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_reviews`          | UUID `id`; `google_place_id`; `user_id` referencing Auth; rating smallint 1–5; optional comment max 1,500; created/updated timestamps; nullable `deleted_at`, `hidden_at`, `moderation_note` max 1,000; unique `(user_id, google_place_id)` |
| `service_favorites`        | Auth `user_id`, `google_place_id`, created timestamp; composite primary key                                                                                                                                                                 |
| `user_service_preferences` | Auth `user_id` primary key, 5-digit `postal_code`, `radius_miles` in 5/10/25/50, created/updated timestamps                                                                                                                                 |
| `service_review_reports`   | UUID `id`, review FK, Auth `reported_by`, allowlisted reason, optional details max 500, created timestamp, status pending/reviewed/dismissed; unique `(reported_by, review_id)`                                                             |

Indexes support published reviews per place and the report queue. Auth references cascade on account deletion; reports cascade if their parent review is administratively removed. Normal app behavior only withdraws reviews, never hard-deletes them. One permanent row per user/place is stricter than one active review: editing and republishing reuse the same ID, preserving report history. Moderator-hidden reviews cannot be republished by the author.

### RLS, grants, and RPCs

All four tables enable RLS. No browser role gets direct INSERT/UPDATE/DELETE grants. Mutations use narrowly scoped `SECURITY DEFINER` functions with empty search paths, explicit execute grants, and ownership derived from `auth.uid()`. There is no caller-supplied author argument. No service-role credential is used by the app.

Public review column grants expose only review ID, Place ID, rating, comment, and timestamps; RLS admits published rows only. Reviewers' auth UUIDs and moderation fields cannot be selected or used as query filters by public/member roles. Community DTOs use the fixed label **Pawport Member**, never account metadata, emails, household names, pet IDs, or location preferences. Review UUIDs identify reviews and are not auth UUIDs. React renders comments as escaped text, without HTML parsing.

- `save_service_review`: validates content, serializes per-user creation with a transaction advisory lock, allows up to 10 new reviews per rolling day; edits own row.
- `withdraw_service_review`: own review only, soft withdrawal.
- `my_service_review`: own content/status only, no author identifier.
- `service_community_summaries`: max 20 validated Place IDs; published Pawport-only average/count derived from rows.
- `read_service_reviews`: privacy-safe newest-first pages of 20, offset capped at 1,000.
- `set_service_favorite`: own records, idempotent, max 100 saved IDs, transaction-serialized.
- `set_service_preference`: own ZIP/radius, null ZIP deletes preference.
- `report_service_review`: published review only, one report/user/review, max 20 reports per rolling day. A report does not hide anything.

Favorites, preferences and report reads are owner-only. Reports have no end-user mutation grants, so reporters cannot change moderation status. Internal auth references are retained for enforcement but absent from user-facing projections. No new service function queries pet/medical data or changes provider visibility.

## API and abuse controls

| Endpoint                                         | Behavior                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/services/search`                      | Same-origin check, authenticated member, strict JSON input, search budget, one search plus optional ZIP geocode, one bulk community summary |
| `GET /api/services/place/[placeId]`              | Authenticated detail budget, validated encoded ID, fresh Google detail                                                                      |
| `GET /api/services/saved?offset=0`               | Authenticated search budget, owner-only favorites, six fresh detail requests at most per explicit page                                      |
| `GET /api/services/community/[placeId]?offset=0` | Public safe review projection, no Google requests                                                                                           |
| Server actions under `/services`                 | Reauthenticate, validate each action, invoke scoped RPCs and revalidate relevant pages                                                      |

Input schemas reject extra client fields, arbitrary URLs/endpoints, field masks, categories and radii. Place IDs are bounded to 1–255 ASCII letters/digits/underscore/hyphen; route segments are encoded. This accommodates opaque IDs without assuming a ChIJ prefix. Request bodies are capped at 8 KiB. Google requests use fixed HTTPS hosts, refuse redirects, and time out after 10 seconds. Errors are sanitized for configuration, quota, unavailable/invalid ZIP, unavailable business, malformed upstream data, and generic failures. HTTP 429 includes Retry-After.

A bounded process-local limiter allows per member, per five minutes: 20 search/saved-list calls, 60 detail calls, 60 writes. It stores only member ID and counters. This is **not a distributed hard spending cap**: multiple instances and restarts reset available budget. Database review/report/favorite limits still apply to direct authenticated RPC calls. Before scaling, add a shared limiter at `serviceSession`, enforce Cloud API quotas, and monitor usage. Budget alerts alone do not stop charges.

## Manual Google Cloud and local setup

1. Create/select a Google Cloud project for Pawport; enable billing. Prefer separate staging and production projects/keys and budgets.
2. Enable **Places API (New)** and **Geocoding API**. Do not enable Maps JavaScript for this implementation.
3. Create an API key. Set **API restrictions** to exactly those two APIs. Apply server IP application restrictions when fixed outbound egress is available. Browser HTTP-referrer restrictions are not suitable for these server calls. Ordinary serverless egress may not be stable: use a supported fixed-egress setup for IP restrictions, or document that limitation and retain API restrictions, conservative quotas, monitoring and rotation. Follow [Google API security guidance](https://developers.google.com/maps/api-security-best-practices).
4. Configure conservative per-API quotas, billing alerts and access to usage/error dashboards. Confirm enabled APIs and key restrictions with a staging request.
5. Add `GOOGLE_MAPS_API_KEY=...` privately to local `.env.local`. Never use `NEXT_PUBLIC_`, commit the key, or expose it through `next.config.ts`. Existing Supabase URL/publishable key and app URL settings remain required for member workflows. No new service-role or service-account secret is needed.
6. Configure a disposable local/staging Supabase project with migrations 001–004 and test members. Do not point acceptance tests at production. Nothing in `npm test` applies remote migrations automatically.
7. With Node 22+, run `npm ci`, then `npm run dev -- --port 3001`. Restart after changing server environment variables. Sign in with a staging account and visit `/services`.
8. For a later authorized Vercel release, add the key as the server-only `GOOGLE_MAPS_API_KEY` secret in the intended environment, using separate preview/staging configuration. This handoff does not deploy or configure Vercel.

## Automated tests and local acceptance

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Tests mock Google; no real Google key is required. Build with `GOOGLE_MAPS_API_KEY=pawport-phase4-secret-sentinel npm run build`, then `npm test`, to additionally scan generated client assets for credential leakage. The sentinel is deliberately fake, not a usable key.

New suites:

- `services-search.test.ts`: ZIP/GPS validation, radius/category/URL/field injection denial, ZIP resolution, supported/fallback methods, 50-mile bounds, duplicate IDs, filtering, fixed masks, detail projection, error/quota/no-key behavior, limiter and review constraints.
- `services-database.test.ts`: real PostgreSQL in PGlite applies all four migrations; proves unchanged medical rows/policies and old verified shares, create/edit/withdraw/republish, identity protection including direct table grants, anonymous denial, uniqueness, published aggregation, favorites/preferences isolation, report uniqueness and moderation isolation.
- `services-render.test.ts`: separate Google/Pawport scores, no-review text, attribution accessibility and escaped malicious comments.
- `services-security.test.ts`: client import-graph boundary and post-build browser asset scan.

Existing tests are retained. Existing hosted Supabase suites require explicit test credentials and otherwise skip. PGlite validates SQL authorization but does not replace hosted PostgREST, Auth, concurrency, or real Google acceptance. No live Google or hosted Phase 4 end-to-end test is claimed by offline tests.

Local UI checks: signed-out/no-key states, 390px mobile and desktop layout, category/radius controls, no horizontal overflow, visible Google attribution, separate rating sections, review fields and no console overlay. Fictional browser fixtures used for implementation checks must not be shipped or treated as real Google data.

### Staging acceptance checklist

- [ ] Apply 004 after 003 in an isolated staging project; snapshot Phase 1–3 record IDs/counts first and compare afterward.
- [ ] Configure a restricted staging Google key. Search each category with a valid US ZIP; reject malformed/nonexistent ZIPs. Check 5/10/25/50 miles and actual local results.
- [ ] Allow geolocation; inspect the POST payload without retaining it. Deny location and complete ZIP search. Verify no precise coordinates enter tables, logs, browser storage or URLs.
- [ ] Explicitly remember ZIP/radius, reload, verify preference, forget it, reload. Confirm a second account cannot read it.
- [ ] Check Google cards show current attribution, address, rating/count and opening-state fallbacks. Open details; check hours, phone, website and Maps links. Verify no per-card detail fan-out.
- [ ] Simulate Google quota/unavailability, missing key, no results, unrated and unavailable places. Confirm helpful errors and intact pet routes.
- [ ] A creates a review, edits and withdraws it; B cannot edit/withdraw it or spoof author via RPC/REST. A republishes the same row. Verify correct average/count and no Google score mixing.
- [ ] Inspect unauthenticated and member community API responses and RSC props: no auth UUID/email/household/pet/location data. Direct `select=user_id` and `select=*` on reviews must fail.
- [ ] Save/remove places, paginate beyond six, verify privacy between A/B. A stale Place ID remains removable.
- [ ] Report once, reject duplicate, prevent report status editing by members. Verify a report does not change publication. Perform the manual moderation procedure below.
- [ ] Validate HTML-like comments render visibly escaped, keyboard star selection, report reason validation, pending states and mobile controls.
- [ ] Repeat one- and multi-pet vaccination/document/share flows and provider verification; compare existing share-link content and provider scope.
- [ ] Repeat tests/build; check browser bundle for key leakage; inspect no-store and Permissions-Policy response headers through the staging proxy.
- [ ] Check simultaneous review/favorite/report calls using two authenticated staging sessions; confirm database limits/uniqueness under hosted concurrency.
- [ ] Publish reviewed Terms/Privacy, verify Google attribution and billing-region terms, API quotas/restrictions and operational moderation coverage before any public release.

## Safe manual beta moderation

Use the Supabase dashboard/SQL editor only as an authorized operator, in the explicitly selected environment. Never expose an operator credential to the browser or authorize moderators through editable user metadata. Review the report and context; do not automatically hide based on a count or a single report. Keep a restricted operator record of who decided what and when.

Read the pending queue and review content in the SQL editor (this output is private operational data):

```sql
select q.id as report_id, q.review_id, q.reason, q.details, q.created_at,
       r.rating, r.comment, r.hidden_at, r.deleted_at
from public.service_review_reports q
join public.service_reviews r on r.id = q.review_id
where q.status = 'pending'
order by q.created_at;
```

After reviewing a specific case, replace both UUID placeholders with inspected IDs. Use a transaction and verify `RETURNING` targets before committing:

```sql
begin;
select id from public.service_reviews where id = '<review-uuid>' for update;
update public.service_reviews
set hidden_at = now(), moderation_note = 'Operator decision and case reference',
    updated_at = now()
where id = '<review-uuid>'
returning id, hidden_at;
update public.service_review_reports
set status = 'reviewed'
where id = '<report-uuid>' and review_id = '<review-uuid>'
returning id, status;
-- COMMIT only after verifying the exact rows; otherwise ROLLBACK.
commit;
```

To dismiss a report, update only that report's status to `dismissed`; leave the review unchanged. To restore a mistakenly hidden review after review, clear `hidden_at` and update the private note/timestamp for that exact ID, but **do not clear `deleted_at`** (respect the author's withdrawal). Public reads and aggregates exclude hidden/withdrawn rows automatically. Reload to confirm; existing open browser pages are not realtime. This MVP lacks a full moderator audit table/console; preserve restricted operator decision records until those are implemented. Do not hard-delete reviews/reports as a normal moderation action.

## Request counts, limitations, and later rollout

| Explicit user action                                     | Google request flow                            |
| -------------------------------------------------------- | ---------------------------------------------- |
| ZIP search                                               | 1 Geocoding + 1 Nearby or Text Search          |
| GPS search                                               | 1 Nearby or Text Search                        |
| Category change alone / typing ZIP                       | 0                                              |
| Open business detail                                     | 1 Place Details                                |
| Open each saved-list page                                | Up to 6 Place Details; no prefetched next page |
| Write/edit/withdraw/report review, save ID, remember ZIP | 0                                              |

Retries and repeated searches repeat billable requests because business content is not cached. Saved lists are the main details fan-out; explicit pagination bounds it. Google rating/count/current-hours fields raise SKU cost; verify current price tiers and quotas in Cloud rather than relying on a fixed dollar estimate. Details links disable automatic prefetch. Local development React effect checks can cause aborted duplicate fetch attempts; measure production request behavior during staging.

Known limits: US five-digit ZIPs, English Google results, 20 search candidates, approximate distances, incomplete coverage for mobile providers, no booking/claiming/map/photos/Google review excerpts, fixed privacy-safe reviewer label, offset-based community pagination (concurrent changes may shift a page), no distributed rate limiter, no automatic stale-ID migration, and no moderation console. Syntax validation cannot prove that an arbitrary ID entered directly through the database RPC represents a real business; the normal review UI is reached from discovery, and moderation handles abuse. Reviews are member opinions, not proof of a visit or veterinary verification. Phase 2 trust labels remain restricted to medical records.

Recommended later release order: review this branch → isolated staging backup/migrations 001–004 → staging Google configuration → acceptance checklist → review public policies and billing controls → obtain release authorization → additive production migration 004 → configured application release → smoke checks. Do not drop the new tables to roll back UI code; leave additive data intact. No merge, remote migration or deployment is performed as part of this implementation.

## Implementation verification record (September 11, 2026)

ESLint and TypeScript passed. The production Webpack build passed with a fake Google key; the post-build browser asset scan passed. The complete test suite reported **61 tests: 58 passed, 3 skipped, 0 failed**. The three skips are existing hosted Supabase suites without test credentials. Local HTTP checks returned 401 for signed-out paid search and 400 for invalid category/radius input, both with private/no-store caching. Services allows self geolocation while `/` retains geolocation denial. Browser checks covered actual no-key/signed-out screens and fictional populated mobile cards, business details and community forms with no page errors. The temporary fixture was removed before the build. Real Google calls, hosted Phase 4 workflows and distributed concurrency remain staging acceptance tasks; no remote migration or deployment was performed.
