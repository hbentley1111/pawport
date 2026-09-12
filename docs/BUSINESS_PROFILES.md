# Claimed Business Profiles — Phase 7B

## Purpose and boundaries

Phase 7A establishes who may represent a business. Phase 7B lets that business describe itself. “Claimed on Pawport” means representative-managed, not licensed, medically credentialed, endorsed, medically vetted, or guaranteed service quality.

`service_provider_organizations`, locations and business memberships remain separate from `veterinary_providers` and `provider_memberships`. Neither publication nor a veterinary service category creates veterinary identity, verification authority, household access, scheduling permission or availability capability. No booking, vendor integration, team invitation, billing, advertising or review response feature is added.

## Provider-owned data and Google separation

All saved text is entered by the provider. No Google name, address, phone, website, hours, category, rating, review, coordinate or photo is prefilled or persisted by this feature. Organization name remains the claimant/provider-entered name in the Phase 7A organization table; claims retain their original evidence snapshots.

The existing location's `google_place_id` connects the profile to discovery. The public profile contains only provider-entered data and links to `/services/{placeId}` for current Google information and Pawport reviews. Local Services renders a separate **From the business** section. Provider contact fallbacks use location → organization only, never Google fields.

Existing Google API field masks, key handling, attribution and request-time/no-store behavior are unchanged. There are no additional Google calls for profiles. See [LOCAL_SERVICES.md](LOCAL_SERVICES.md) for Google configuration, attribution, persistence restrictions, and public Terms/Privacy launch requirements.

## Migration and schema

Additive migration: `supabase/migrations/202609110012_business_profiles.sql`, after Phase 7A `202609110011_provider_claiming.sql`. No existing business or pet rows are rewritten or recreated.

| Table                                    | Purpose                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `service_provider_organization_profiles` | One profile per organization: tagline, description, website, public email/phone, current logo reference, editor and timestamps.            |
| `service_provider_location_profiles`     | One profile per location: display name, provider-entered address, contact overrides, timezone, hours-provided flag and publication status. |
| `service_provider_location_hours`        | At most two opening windows per weekday.                                                                                                   |
| `service_provider_services`              | Location-specific descriptions, category, ordering and active/archive state.                                                               |
| `service_provider_assets`                | Private logo upload manifest, MIME/size, immutable organization/uploader/path and pending/current/retired lifecycle.                       |

Organization name remains in `service_provider_organizations`. Composite logo FK `(organization_id, logo_asset_id)` prevents cross-organization attachment. Identity triggers prevent profile relocation and asset identity changes. No profile fields are put in claims.

Indexes follow actual access: profile primary keys; hours unique `(location_id, day_of_week, slot)`; active services `(location_id, display_order, id)`; one current logo per organization; pending upload lookup `(organization_id, created_at)`; unique immutable object path. Existing organization/location/membership indexes are reused.

## Validation and contact information

Plain text uses escaped React rendering; no HTML editor or `dangerouslySetInnerHTML`. Bounds: name/tagline/display name 160; description 3000; service name 120 and description 500; address lines 160, city/region 100, postal 30; country code two uppercase letters; phone 40; public email 254; URL 2048. Contact fields are optional, and blank strings become null. Public email syntax is checked but ownership is not verified. The editor explicitly warns that this email is public and independent of the private claim email.

Website URLs accept HTTP(S) only; reject credentials, backslashes, whitespace/control characters and other schemes. Location timezone is optional and must match PostgreSQL timezone names; the application also validates with Intl. No geocoding or claim of canonical address accuracy occurs.

## Hours

Sunday = 0 through Saturday = 6. Slots are 1 or 2. Replace the complete schedule transactionally, with at most 14 rows; a failure rolls back the replacement.

`hours_provided=false` means **No hours provided**. When true, absent days explicitly mean **Closed**. A 24-hour row has no opening/closing times and cannot coexist with a second window. Normal windows require opening < closing and cannot overlap. Adjacent windows are allowed. Times use the location timezone when provided; they are displayed as local wall-clock hours, not converted to the visitor's timezone. No live “open now” claim is calculated from provider hours.

Overnight windows, holiday exceptions and seasonal schedules are deferred. The editor supports whole-day 24-hour service; normal windows are bounded to 00:00–23:59.

## Services

Categories: veterinary, emergency_veterinary, grooming, walking, sitting, boarding, training, daycare, retail, other. These describe offerings, not credentials. Up to 50 active services per location; display order 0–1000 with ID tie-breaker. Organization locking serializes concurrent writes and limit checks. Updates preserve identity; archive hides a service publicly while retaining its row. Restore/history UI is deferred.

## Publication and management

Claim approval does not create or publish profile content. Location status defaults to **draft**. Owner/admin explicitly confirms **Publish profile** after reviewing a private preview of saved data. Optional content is not mandatory. **Unpublish profile** hides the public page, teaser and logo but retains profile data and the Phase 7A claimed status.

Saving changes to an already published profile updates live content immediately, including organization fields shared by multiple locations. The editor states this clearly; there is no separate versioned draft of an already published profile. Save each form section to update the private preview.

Routes:

- `/provider/businesses`: bounded organization/location management index, also linked from Account and My Claims.
- `/provider/businesses/[organizationId]`: organization details, logo and location links.
- `/provider/businesses/[organizationId]/locations/[locationId]`: location details, services, hours, saved preview and explicit publication.
- `/providers/[locationId]`: public profile, only for active organization + active location + published profile.
- `/providers/[locationId]/logo`: controlled public logo byte delivery.
- `/provider/businesses/[organizationId]/logo`: current-logo member preview.
- `/provider/businesses/logo-upload`: same-origin authenticated upload endpoint.

The existing `/provider` veterinary workspace is unchanged. Business-only users do not need a household or pet. Owner/admin can mutate; staff/scheduling managers see read-only management information. Suspended organizations show unavailable management status; suspended locations cannot be edited or published. Public profile and logo access stop for suspended organization/location. History is preserved.

Forms have visible labels, keyboard focus, status/error announcements, touch-friendly controls and responsive layouts. Public pages prioritize business name, description, services, contacts and hours. No dense administrative grid or credential badge is introduced.

## DTOs and reads

A central explicit SQL builder normalizes profile fields, reused by public reads and authenticated preview. It is not directly executable by browser roles.

`ServiceProviderPublicProfile` (`PublicProfile` in code) contains location ID, existing Google Place ID for the listing link, business/location names, claimed label, description/tagline, public contacts, normalized address, timezone, hours, active services, controlled logo URL and source label. No claim evidence, reviewer note, user/member IDs, private email, storage path, scheduling IDs or veterinary IDs are returned.

`service_provider_public_profile` and `service_provider_public_profile_for_place` are safe anon/authenticated RPCs; drafts and suspended/unpublished profiles return no profile. Metadata uses only provider-entered name/tagline and neutral Pawport branding.

`my_service_provider_businesses` returns up to 100 member organizations and 100 locations each. `service_provider_profile_editor` checks active membership and returns management fields, edit capability, publication states and private preview. It does not return claim evidence. Organization IDs belong only to management/previous claimed identity flows, not public profile content.

Dynamic pages and logo responses use private/no-store behavior. Publication is checked on every public read; no public profile snapshot or Google mirror table is created.

## Logo storage and delivery

Migration creates PRIVATE bucket `provider-profile-assets`, JPEG/PNG/WebP only, max 3 MiB. SVG is rejected. No new secret or service-role environment variable is required.

1. Same-origin upload route verifies signed-in user and bounds both Content-Length and streamed body (3 MiB plus 64 KiB multipart allowance).
2. Validate extension, MIME, size and file signature in the application.
3. `prepare_service_provider_logo` requires owner/admin, locks organization, creates pending manifest with collision-safe `logos/{server-generated-asset-uuid}` path. Paths are never supplied by the client. Pending uploads expire after one hour; a subsequent prepare retires expired rows. Maximum 20 prepares per organization per day.
4. Upload once with upsert disabled through the authenticated Supabase client. Storage INSERT checks manifest, permission and expiry. No object UPDATE is permitted.
5. `finalize_service_provider_logo` locks organization and asset, verifies object existence and exact metadata MIME/size, retires old current logo, makes new current and atomically updates the composite organization/logo reference. Repeat finalize on current logo is safe. Expired or foreign assets fail.
6. Public profile DTO contains only `/providers/{locationId}/logo`. Delivery RPC resolves active/published location or active member preview to an opaque asset key and content metadata, never raw storage path. The server derives the path, downloads with ordinary Supabase RLS, verifies size/signature and rechecks eligibility before proxying bytes. It does not redirect to a long-lived signed URL.

Storage SELECT allows owner/admin access to their own upload objects (including retired objects for cleanup). For other readers, it permits only current logos belonging to an active organization with a published active location, or current logos of an active organization member. Thus even a guessed/previously learned path cannot read a draft, retired or suspended public logo. A current logo used by a published sibling location is intentionally public organization-wide. The private bucket is never made public; Supabase's permanent public-bucket URL does not work. As with any public image, bytes already downloaded cannot be recalled.

Retired blobs are kept for safe later cleanup rather than risking replacement failure. A normal owner/admin may delete only retired objects from their own active organization; unrelated organizations and current objects are protected. A trusted maintenance tool can later clean expired/retired manifests and objects, respecting current references; no production cleanup job is installed.

### Existing Storage guard compatibility

The Phase 2 restrictive `health_document_read_guard` directly referenced a private table. PostgreSQL checks SELECT privilege on that table even when reading an unrelated bucket, which prevented anonymous published-logo reads. Migration 012 moves the **same authenticated/document-access predicate** into `bp_health_storage_read_guard` with fixed empty search_path, and changes only that storage guard expression to call it. No medical table grants or owner/provider visibility rules are broadened. Other medical and pet RLS policies remain untouched. Tests exercise anonymous denial, owner access and unrelated business-member denial after this compatibility change.

## RPC and RLS security

All five new tables have RLS enabled and no browser table access. Direct grants are revoked from PUBLIC, anon, authenticated and Supabase default service_role where present. Internal helpers have no browser EXECUTE grants. Public RPCs return only active published data or authorized current-logo delivery metadata. Authenticated management mutations derive identity from `auth.uid()` and never accept editor/uploader IDs.

Narrow mutations: save organization; save location; replace hours; save/archive service; publish/unpublish; prepare/finalize logo. Authorization locks organization and membership, then checks location belongs to that organization and is active. Browser URL IDs do not establish access. Staff/scheduling-manager permission does not imply editing. RLS guards on Storage also resist unrelated permissive policies and prohibit object overwrites.

Logo SQL metadata validation complements application signature checking. A provider could upload arbitrary bytes through a direct authorized Storage call, but the public/member delivery route checks signatures and responds with nosniff plus sandbox CSP. Full image decoding/re-encoding and malware/content moderation are deferred.

## Independence from reviews, medicine and scheduling

Pawport review authorship, public privacy, rating aggregation and moderation rules are unchanged. Businesses get no review edit/delete/identity/suppression privileges. The public profile links to existing Community reviews instead of copying review data.

Publishing a veterinary service does not create `veterinary_providers` or `provider_memberships`, expose health documents or verification queues, activate a scheduling connection or enable Smart Openings. Those remain independent trust and capability systems. No Google category is interpreted as professional evidence.

## Tests and acceptance

Automated tests use PGlite with migrations 001–012, real SQL roles/RPCs/RLS and simulated Storage metadata. They cover owner/admin vs staff/scheduling/unrelated users, location mismatch, suspension, draft/public/unpublish, safe DTOs, input bounds, service lifecycle/limits, schedule overlap/24-hour rules, logo lifecycle/expiry/cross-org ownership, and medical separation. Pure render/schema tests cover source labels, escaped text, contacts, states and upload validation. Existing Phase 1–7A tests remain; the previous “profile management coming next” assertion is updated to require the now-real management link.

Run:

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

Build precedes full tests so the existing client-bundle secret scan sees complete `.next/static` output. Do not run build concurrently with that scan.

Local/browser acceptance uses development-only fixture data to inspect actual components at 390px, 768px and 1440px without creating business or medical records. Remove the visual fixture before committing. Hosted auth/Storage workflows still require isolated staging acceptance; no remote migration or writes are performed by this implementation task.

### Isolated staging procedure (manual, after review)

1. Back up staging and confirm migrations 001–011 are present. Apply 012 to staging only. Confirm bucket is private with three MIME types and 3 MiB limit. No new application secrets or Google APIs are needed.
2. Through the existing restricted claim reviewer, approve two test organizations/locations. Use separate owner/admin/staff/scheduling-manager/unrelated accounts; set test memberships through a trusted staging SQL context, never browser table writes.
3. Open Business profiles from Account/My Claims. Enter a name/contact/address deliberately different from current Google data. Save and verify the Google listing remains unchanged.
4. Add/edit/archive services; test veterinary category without any new verification or scheduling access. Test two daily windows, overlap rejection, 24-hour day and no-hours vs explicit closed.
5. Upload PNG/JPEG/WebP; reject SVG, mismatched signature/extension and >3 MiB. Replace logo and confirm old asset retired. Confirm unrelated draft-logo access and direct object overwrite fail.
6. Preview saved draft privately; signed-out public profile/logo and Local Services teaser must remain unavailable.
7. Publish explicitly. Signed-out profile, source labels, contacts, hours and controlled logo should appear. Verify Local Services Google details and Community reviews still work alongside the separate teaser.
8. Unpublish: profile/logo/teaser disappear; claimed badge remains. Suspend location then organization in trusted staging context and verify reads/mutations stop; restore only via trusted context.
9. Check mobile/keyboard labels, focus, hours controls and publication confirmation. Recheck login/reset-password, Today, pets, records/shares, Care, Openings, Timeline, reviews and veterinary verification.
10. Test private health document read as its owner and narrow authorized verifier, and denial as anon/unrelated business member. Test a known draft/retired logo path directly against Storage, not just the public page.

## Local verification results

On September 12, 2026: `npm run lint`, `npm run typecheck` and `npm run build` passed. `npm test`: 188 tests total, 185 passed, 3 existing hosted-integration tests skipped, 0 failures. The built-client secret scan ran. Browser checks of actual profile/editor components at 390, 768 and 1440 pixels found no horizontal overflow; all 38 rendered editor controls had labels and no browser errors were reported. Signed-out `/provider/businesses` redirected to `/login`. Temporary visual fixtures were removed. No remote database or Storage mutations were performed.

## Known limitations and Phase 7C readiness

No overnight/holiday schedules, logo cropper, image re-encoding, public image recall, draft versioning for already published content, service restore UI, team invitations, role-management UI or profile analytics. Retired assets require later cleanup. Management views are bounded rather than fully paginated. Existing business claim disputes remain a separate future workflow. No real vendor, booking, credential verification, billing, email or push delivery is added.

Phase 7C can build organization/location switching, team management and operational views on existing `service_provider_memberships` and these profiles. Profile fields do not belong in claims. Scheduling connection visibility may be integrated later using deliberately authorized business/location links; publication itself must never activate capabilities. Any future veterinary linkage requires explicit professional verification independent of claiming and profile content.
