# Phase 3 — multi-pet households and profiles

Work branch: `feature/multi-pet-profiles`. No merge, push, deployment, or remote migration is performed by this implementation.

## Behavior and routes

- `/` is the household entry point. With exactly one pet it renders that pet’s dashboard directly. With multiple pets it shows named, responsive cards with avatars/photos, breed/species, vaccination counts, and recorded due dates. No arbitrary first-pet selection is used.
- `/pets/new` adds a pet after normal onboarding, up to 20 per household. Creation redirects to the new pet’s passport.
- `/pets/[petId]` loads exactly the requested, owner-accessible pet. It includes Overview, Health Records, Vaccinations, Share Passport, Edit profile, household navigation and Add pet. Vaccinations and sharing use anchors on this page.
- `/pets/[petId]/records` contains the existing Phase 2 document and verification workflow, filtered by that pet ID.
- `/pets/[petId]/edit` edits name, species, breed, birth date, sex and microchip using the same validation as creation, and offers photo upload/replacement.
- `/pets/[petId]/photo` serves only the current photo to the authenticated owner, with `private, no-store`, `nosniff`, and a sandbox CSP. Other owners, providers and signed-out visitors receive an unavailable response.
- `POST /pet-photos/upload` validates same-origin requests, authentication, UUID, bounded multipart size, filename, MIME/extension and file signature before reserving/uploading/finalizing a photo through the caller’s Supabase session.
- `/records` remains a compatible bookmark: redirect to records for exactly one pet; show a pet choice for multiple pets. Empty households continue onboarding. Existing owners are not re-onboarded.
- `/help` describes multi-pet profiles, photo privacy and existing trust labels.
- `/onboarding` checks pet count, rather than expecting a single row. `/documents/upload`, existing record actions, vaccination and share actions now invalidate per-pet views. Share revocation validates both the pass ID and the selected pet ID before calling the unchanged RPC.
- `/provider`, `/share/[token]`, authentication and Phase 2 SQL/RPCs remain unchanged. The public share field allowlist still excludes microchip, photo, document links, household, owner details and verifier identity.

## Migration: exact schema changes

Apply `supabase/migrations/202609110003_multi_pet_profiles.sql` **after** migrations 001 and 002. On existing Phase 2 installations, apply only 003.

The migration is transactional and:

1. Finds and drops only the single-column UNIQUE constraint on `pets.household_id` (normally `pets_household_id_key`). It deliberately fails if the expected constraint is absent or ambiguous. It preserves `pets.household_id` and its existing household foreign key.
2. Adds the non-unique index `pets_household_id_idx`.
3. Adds `guard_pet_household()` and the `pet_household_guard` BEFORE INSERT/UPDATE trigger. Inserts lock the household row, then enforce at most 20 pets, including direct API/bulk writes. Updates cannot change `id`, `household_id` or `created_at`.
4. Grants authenticated users UPDATE on **only** `name, species, breed, birth_date, sex, microchip`. Adds the `pet_update` RLS policy with owner authorization on both the old and new row. Existing pet SELECT/INSERT policies remain in place; no pet DELETE grant or policy is added.
5. Creates `pet_photo_uploads`: `id uuid` primary key, `pet_id uuid` FK to pets with cascade, unique `object_path text`, allowlisted `mime_type text`, bounded `byte_size integer`, `status text` constrained to pending/current/retired, and `created_at timestamptz`. Adds an index on `pet_id` and a partial unique index allowing one current photo per pet.
6. Adds nullable `pets.photo_id uuid` with a foreign key to `pet_photo_uploads(id)`. Existing pets receive null; no pets or related records are recreated. Replaces authenticated table-wide pet INSERT permission with INSERT on the original columns, preventing photo-pointer injection during creation. Owners cannot directly update the pointer or photo reservation rows.
7. Adds owner-only SELECT RLS on `pet_photo_uploads`, and `prepare_pet_photo`, `finalize_pet_photo`, and the authorization helper `can_access_pet_photo`. Functions use an empty search path and explicit caller authorization. Only the authorization helper is callable anonymously; it returns false without an authenticated identity. Mutation RPCs are authenticated-only.

Existing vaccination IDs, provenance, share tokens, documents, verification requests and audit rows are untouched. The offline migration test compares pre/post-migration rows across all eight affected Phase 1/2 data tables, with the sole added pet field excluded from comparison.

## Photo bucket and replacement

Migration 003 creates the private `pet-photos` bucket with JPEG/PNG MIME restrictions and a **3,145,728 byte (3 MiB)** per-file limit. This deliberately fits the existing application upload design and Vercel request-body limit with multipart overhead; it is smaller than the suggested 5 MiB. No new environment variables or service-role key are used by the application.

Paths are generated in PostgreSQL as `householdUUID/petUUID/photoUUID.extension`. Owners cannot reserve another household’s pet or upload arbitrary paths. Each reservation expires for upload/finalization after one hour; at most ten pending reservations per pet may be created in a rolling hour.

Storage policies `pet_photo_read`, `pet_photo_insert`, and `pet_photo_delete` allow owner access to reserved objects, inserts only for unexpired pending reservations, and deletion only for retired photos. Corresponding restrictive guards apply even in the presence of unrelated broad permissive policies. A restrictive UPDATE guard prevents all object overwrites/upserts in this bucket. Existing health-document bucket policies are not changed.

Replacement sequence:

1. Reserve a new path and upload it without upsert. The current photo remains unchanged.
2. Finalize under a pet-row lock; check stored object MIME/size, retire the previous photo, activate the new one and switch `pets.photo_id` in a single database transaction.
3. Attempt to remove the retired object through Storage using the owner’s session. Retired objects cannot be reactivated, so this cleanup cannot delete a subsequent replacement. A repeated finalize on the current photo is idempotent.

Interrupted uploads can leave pending reservations/objects. A failed cleanup can leave a retired object. These files remain private; no public/signed URL is issued by the application. The owner can read their own reserved objects through authenticated Storage APIs, and authorized clients could create their own signed URLs. This is consistent with the existing document security model. Profile photos are **not included in public share passes or provider disclosure**.

Operator cleanup: inspect `pet_photo_uploads` and `pets.photo_id`; only remove expired pending objects or retired objects, using the Storage API before deleting reservation rows. Never delete Storage metadata directly. Do not delete a current photo/pointer as a routine cleanup. No automatic retention job or owner-facing pet deletion is added.

## Tests and local verification

Required commands:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

New suites:

- `tests/multi-pet-database.test.ts`: real PostgreSQL engine via PGlite, all three migrations, historical data preservation, foreign key retention, second/third pets, owner-only profile updates, immutable ownership and IDs, cross-tenant denial, selected-pet vaccinations/documents/trust, cross-pet attachment denial, narrow provider access, old share compatibility, independent pass revocation, private photo policies under broad pre-existing policies, replacement/cleanup/idempotency, invalid/expired reservations, direct/bulk 20-pet cap and profile editing at the limit.
- `tests/pet-profiles.test.ts`: profile validation and field allowlisting, photo formats/size/signatures, vaccination summary behavior.
- `tests/multi-pet-supabase.test.ts`: gated hosted test for concurrent inserts at the household cap and real Storage MIME/size, upload/read/overwrite/delete/replacement enforcement. Uses disposable test users and cleans up their resources.

Hosted tests require a **dedicated staging/test project**, all migrations, and `TEST_SUPABASE_URL`, `TEST_SUPABASE_PUBLISHABLE_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` supplied only to the test process. Never place a service key in application configuration or chat. Existing hosted suites are preserved. Without credentials all three hosted suites explicitly skip.

PGlite models the Auth/Storage database contracts, not actual JWT validation, Storage HTTP, or concurrent database connections. The hosted suite and browser acceptance below remain necessary before rollout.

## Results in this workspace

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 37 passed, 0 failed, 3 hosted suites skipped because dedicated test credentials were not supplied. Existing tests were not weakened or deleted.
- `npm run build`: passed (Next.js 16.3.4, production Webpack build); all expected new routes were generated.
- Browser visual checks: actual household, pet-dashboard and profile-editor components rendered with local sample fixtures at desktop and 390px mobile widths. No browser errors or page-width overflow were observed. The vaccination dialog contained the selected sample pet ID and the edit form contained the expected profile defaults. The temporary fixture route was removed before the final build. This is UI verification, not a live authenticated end-to-end test.
- Real signed-out homepage rendered the login UI. Anonymous private-photo GET returned 404; cross-origin photo POST returned 403. No real-user mutation was performed.
- Both existing migrations and all pre-existing test files remain unchanged. All implementation and verification work is on `feature/multi-pet-profiles`; no merge, remote migration or deployment was performed. `AGENTS.md` and `CLAUDE.md` were pre-existing untracked files generated by the earlier development server.

## Exact staging acceptance procedure

Use separate browser profiles for Owner A, Owner B, Vet, and signed out.

1. Start from a staging copy of Phase 2 with Owner A’s existing single pet, vaccination, document-supported and verified records, and saved share URLs. Record those IDs and counts. Back up staging before migration.
2. Apply only migration 003. Check old data/IDs and provider verification history are unchanged. Confirm the existing share URL still resolves anonymously with the correct trust attribution.
3. Run the Phase 3 application against staging. Owner A should land directly on the familiar one-pet dashboard without onboarding or an extra selector.
4. Edit every allowed pet field, including clearing birth date/microchip. Refresh to verify persistence. Test invalid dates, blank required fields, invalid species/sex and invalid microchip characters.
5. Add second and third pets via Add pet. Confirm the redirect names the new pet and the household page now displays three distinct cards. Check all pet navigation, records and action dialogs target the selected pet.
6. Give each pet differently named vaccinations/documents. Open their records pages and confirm no cross-pet list mixing. Attempt a cross-pet document association through an authenticated API client; it must fail even for the same owner.
7. Submit only Pet A’s record to Vet. Vet must see only that submission and attached evidence, not Pet B’s history, photos or documents. Complete verification; confirm only Pet A gets its attestation. Exercise cancellation and revocation as in Phase 2.
8. Open the original share URL. It must still show only Pet A, with current profile details and correct trust. Generate a Pet B pass, revoke it from Pet B’s page and confirm Pet A’s pass still works. Check expired and revoked links.
9. Upload JPEG, JPG and PNG photos; refresh household and per-pet pages. Replace one photo; verify the new object is current and the old object was removed. Simulate an interrupted upload and confirm the previous current photo remains available. Attempt unsupported extensions, MIME mismatch, empty files, bad signatures and files over 3 MiB.
10. As Owner B or Vet, attempt direct Pet A page/photo/document URLs, pet inserts into Owner A’s household, pet updates and photo uploads/downloads. Deny all unauthorized access. Anonymous photo URLs must also fail. Owners must not be able to overwrite/delete a current photo or move a pet by changing `household_id`.
11. Run the hosted suites. The Phase 3 hosted test races two requests when 19 pets exist and expects exactly one success. Confirm pet 21 fails while existing profiles remain editable.
12. Repeat the key flows at 390px width and with keyboard navigation: distinguish pet cards, open pet, edit, upload, add vaccination, generate/revoke share pass, navigate back. Confirm fallback avatars render for missing/unavailable photos.
13. Create a new test account: household → first pet → pet dashboard → second pet. Existing accounts must continue working without repeating onboarding.

## Risks, compatibility and deployment order

- Migration 003 briefly requires locks while changing the constraint/index. Plan the migration window for database size/load and take a backup. Unexpected schema drift or a pre-existing `pet-photos` bucket causes a transactional failure that needs operator inspection, rather than silently adopting an unknown bucket.
- **Deploy the schema before the application.** The original Phase 2 app can still handle single-pet households against the new schema, but its single-row queries will fail once a household has multiple pets. After users add additional pets, roll forward with a compatible app; do not roll back to Phase 2 or delete pets to recover.
- Profile edits change what existing share links and provider queues display for that immutable pet ID. Verification remains an attestation to the existing vaccination record, not to an immutable snapshot of the editable pet profile. Do not use profile editing to substitute a different animal; corrections to attested records still need the Phase 2 operator process.
- Signature checks are not image authenticity checks or malware scanning. The app serves only allowlisted raster MIME types with defensive headers and no public image optimization cache. Real image decoding and storage behavior need staging verification.
- Storage and PostgreSQL are not a distributed transaction. Interrupted uploads, uncertain network responses after finalization, and cleanup failures may leave private orphan files. Refresh after an interrupted request to determine which photo is current.
- No hard pet deletion, medical notes, diagnoses, medications, weight tracking, conditions, AI, invitations or unrelated product features are included.

Manual Supabase setup: apply migration 003 on staging; verify `pet-photos` is private, the two MIME types and 3 MiB bucket limit are present, and global Storage permits at least 3 MiB. Keep Phase 2 provider memberships and bucket policies as configured. No additional application secrets or Auth settings are required. For localhost/staging, ensure the existing app URL and Auth redirect allowlist match that environment.

Recommended release order (operator actions, not performed here): backup → migrate staging → run hosted suites and manual acceptance → review this branch → separately authorize a production release → backup production → apply migration 003 → release the compatible app → smoke-test existing/new households, old share URLs, provider scope and photos. Do not deploy Phase 3 code before its migration, and do not drop Phase 2 evidence or audit data on rollback.
