# Unified Pet Timeline & Life Journal — Phase 6B

PetThread remembers the life of a pet through a private chronological history. It does not make medical recommendations, interpret weight, or infer milestones. Timeline = **what happened**; Care and future PetThread Today = **what needs attention now**.

## Authoritative sources, not another database of truth

`my_pet_timeline` is the single SQL normalization layer over existing authoritative records. `lib/timeline/data.ts` provides the server-only transport and cursor encoding. The full timeline and three-item Recent activity preview both call this RPC and use `PetTimelineEvent`. There is no `timeline_events` table, copying job, synchronization task or materialized clinical history.

The only new table is `pet_journal_entries`, for genuinely new owner-added notes, milestones, weights, photos, activities and custom moments. No care completion, appointment, vaccination, document or provider event is inserted into it.

## Migration and journal schema

Apply `supabase/migrations/202609110009_pet_timeline.sql` after 001–008. No remote migration is performed by this task.

Journal columns: UUID identity, immutable household/pet/creator/type, optional title (120 characters), optional note (2000), finite `occurred_at`, validated IANA `time_zone`, original weight/unit, optional photo reference, created/updated timestamps, and nullable `deleted_at`.

- A milestone requires a title. Note/activity/custom entries require a title or note.
- Backdating before account creation is allowed, down to 1900-01-01 UTC. More than five minutes in the future is rejected. Future routines belong in Care.
- Type and ownership cannot change. Edit changes the content/time of the same moment. Deletion is idempotent soft deletion and cannot be undone through these RPCs.
- No medical-source mutation is available through journal APIs.
- Maximum 50 new moments per owner per rolling day, serialized with an advisory lock.

## Event contract

`PetTimelineEvent` exposes only:

- Stable `id`, `sourceType`, source-record UUID, pet UUID.
- `occurredAt`, normalized `eventType`, title, optional subtitle/description.
- `trustState`: null, owner_entered, document_supported, or vet_verified.
- Category: health, care, appointments, life.
- Authenticated local `actionUrl`, optional authenticated `photoUrl`.
- Explicit metadata only: care category, appointment type, journal type, original weight/unit, and time zone.

Household/creator identifiers, provider IDs, connection/vendor identifiers, storage paths, audit internals and private verification notes are excluded. Safe source IDs are used for deterministic identity and owner-only routes; they confer no authorization.

Stable IDs include `care:{occurrence}:completed`, `appointment:{appointment}:cancelled`, `vaccination:{vaccination}`, `document:{document}` and `journal:{entry}`. No new random event IDs are generated on reads.

## Source mappings and dates

| Source          | Meaning                                                    | Timestamp                                                            | Destination                      |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| Care occurrence | Completed or skipped owner routine                         | completed_at / skipped_at                                            | Care plan detail                 |
| Appointment     | Current completed/cancelled outcome                        | Completed: ends_at, falling back to starts_at. Cancelled: updated_at | Appointment detail               |
| Vaccination     | Added, documented, verification requested/verified/revoked | Corresponding current lifecycle timestamp                            | Pet Health Records               |
| Health document | Uploaded medical document, safe original filename          | uploaded_at                                                          | Existing secure document handler |
| Journal         | Owner-added note/milestone/weight/photo/activity/custom    | Owner-entered occurred_at                                            | Moment editor                    |

Care uses `title_snapshot`, `category_snapshot`, and the occurrence time-zone snapshot, never a renamed current plan title. Pending care and cancelled schedule revisions are omitted. Completion/skip notes are private owner-entered descriptions, never verification evidence.

Appointments have no authoritative completed_at/cancelled_at history fields. The above timestamp convention is explicit: a completed appointment represents its scheduled end/start; cancellation represents the latest saved outcome. Subsequent edits may move a cancellation's displayed time. There is one event per current terminal outcome, not a stream of rescheduling mutations. External appointment descriptions say “Synced from provider”; no external IDs, connection metadata, or Google-derived business content is returned. Only existing user-entered provider labels are used. Future appointments and pending care are not displayed as history.

### Vaccination provenance and verification deduplication

One current lifecycle representation per vaccination avoids near-identical “record updated” and “verified” cards. The latest verification request is selected deterministically by requested_at and UUID; verified, pending and revoked states select their corresponding event. Otherwise a finalized linked document yields documented, falling back to added at created_at. A cancelled verification request does not create a separate life event.

Trust uses the same rules as existing records: verified status with provider name and verified timestamp yields **Vet verified**; a finalized attached document yields **Document supported**; otherwise **Owner entered**. A revoked verification never retains a current verified badge. The provider's internal identity and verification notes are not included. A document upload remains a distinct useful event from a vaccination it supports.

This is a current-state read model, not an immutable verification audit viewer: later verification/revocation changes the vaccination's displayed lifecycle event and timestamp while retaining its stable vaccination ID. Detailed historical verification audit remains authoritative in its existing system. No journal event receives a medical trust badge.

### Smart Openings

Availability matches and routine watch health/status changes are intentionally excluded. Slots are ephemeral and would overwhelm a years-long pet history. A future durable owner booking action may qualify once it has an authoritative appointment outcome; no such booking feature is introduced here.

## Weight handling

Store the owner's original numeric value and `lb`/`kg` unit, with at most three decimal places. Values must exceed zero and be below 1000 lb or 453.59237 kg. These are input bounds, not medical thresholds. `weightKg` derives kilograms from pounds using 0.45359237 when a future chart needs normalization; no browser-provided normalized value is stored. This phase displays the original measurement and no chart or healthy/ideal/overweight interpretation.

## Private photos and lifecycle

Reuse `pet_photo_uploads` and the existing private `pet-photos` bucket. JPG/JPEG/PNG, matching MIME/extension/signature, maximum **3 MiB** (the existing limit), bounded streaming bodies, same-origin upload and authenticated owner checks are retained.

`/pet-photos/upload` accepts an allowlisted `purpose`: existing/default `profile`, or `journal`. Both use existing `prepare_pet_photo`; journal uploads finalize with `finalize_journal_photo`, which validates actual stored object metadata and marks the row `journal`. It never changes `pets.photo_id`. Journal finalize is idempotent, expires pending uploads after one hour, and limits journal photos to 50 per pet/day.

A photo moment may use a newly uploaded journal photo or the current profile photo. The reference must belong to that same pet and point to a stored object. Pending/foreign/another pet's photos cannot be attached. New references to retired photos are rejected; existing references continue working after profile replacement. Moment creation/edit and profile replacement serialize on the pet row.

Profile replacement still retires the previous profile photo. It returns a cleanup path only if that file is not referenced by a non-deleted journal entry. The existing Storage authorization helper is tightened to deny deleting retired files referenced by a live journal entry. Existing owner read/upload boundaries and restrictive storage policies remain. No new public bucket or URL is created.

`/pets/[petId]/timeline/[entryId]/photo` authenticates, loads the owned non-deleted moment, verifies the same-pet photo reference, privately downloads the object, checks byte size/MIME/signature, and streams bytes with `private, no-store`, nosniff and sandbox headers. Paths never reach the timeline DTO. Missing/broken photos render “This private photo is unavailable.” Owners can edit/delete a moment even if its referenced file has gone missing.

Unattached journal uploads and photos detached by editing/deleting are not automatically hard-deleted. Cleanup is deferred to a bounded operator job that checks current profile and all live journal references, age and ownership before deleting. Journal objects are not given new direct client delete permission. Do not apply the old “retired profile photos can all be removed” assumption to referenced files.

## Pagination, filtering and performance

Filters: All, Health, Care, Appointments, Life. Filter changes reset the cursor. Pages contain 25 events by default, maximum 50; preview requests three. Ordering is timestamp DESC then stable event ID DESC using deterministic C collation. Cursor contains the last event's **original timestamp precision** and event ID, encoded as bounded base64url JSON. The server validates cursor shape and length; SQL validates ownership, filter, page size and paired finite cursor values. SQL reads one extra item to determine nextCursor. The Load more link navigates to the next bounded page, with Back to latest.

Equal timestamps use the event ID tie-breaker, so an unchanged dataset has no repeated/missing boundary records. This is not a snapshot across requests: backdated inserts or edits between pages can change ordering. Reload latest after editing. It does not load a pet's entire history into browser memory.

Existing pet-key indexes bound vaccinations, documents and appointments; care plans are indexed by household/pet and occurrences by plan. The migration adds:

- Journal `(pet_id, occurred_at DESC, id DESC)` for active entries; owner/created_at for the daily limit; live photo-reference index for safe retention.
- Verification `(vaccination_id, requested_at DESC, id DESC)`: the existing open-request unique index excludes revoked/cancelled history needed by the lifecycle lookup.
- Partial care occurrence `(plan_id, completed_at DESC, skipped_at DESC)` for completed/skipped rows, avoiding cancelled revisions/pending rows in the historical join.

UNION ALL normalizes only the requested pet and selected source category. There is no materialized mirror. Global timestamp sorting still costs work over matching source candidates; for very large histories, measure each branch with EXPLAIN ANALYZE on staging and consider per-source seek pushdown/top-N plans before adding more indexes. Do not use a duplication table as a shortcut.

## Security

The new journal table has RLS enabled and no direct browser read/write grants. Narrow SECURITY DEFINER functions have fixed empty search paths and default PUBLIC execute revoked. `save_pet_journal_entry` derives household/creator from the authenticated pet owner; a trigger independently checks consistency and immutable IDs/type. Read, edit and soft-delete paths require ownership. Timeline queries authorize the pet before reading any source. Provider verification membership gives no timeline access.

The timeline RPC explicitly builds normalized JSON; it does not serialize raw source rows. Private medical/document RLS policies, scheduling permissions, review permissions and care worker permissions are unchanged. Photo policy helper changes retain owner-only reads and add reference-aware deletion protection. No worker/anonymous role gains journal or timeline execution. No service-role key or vendor credential is introduced.

## UX and dates

New routes: `/pets/[petId]/timeline`, `/new`, `/[entryId]`, and `/[entryId]/photo`. Pet navigation includes Timeline while preserving Overview, Health Records, Vaccinations, Share Passport and Edit profile. Mobile tabs wrap with touch-sized targets rather than adding a global navigation item. The overview displays up to three recent normalized events and View full timeline.

Add moment supports Note, Milestone, Weight, Photo, Activity and Custom. Type becomes immutable after creation; source-derived cards link to the actual records, not the journal editor. Text uses React escaping, never raw HTML. Photo cards load only authenticated images. Medical documents show filename/date only, not file contents.

Timeline day groups use the browser's local time zone (UTC for server rendering, hydrated consistently through the existing timezone hook). Journal editing retains its saved IANA zone and offers first/second occurrence selection for DST folds; nonexistent spring clock times are rejected. A small future clock tolerance does not make this a scheduling feature. No age calculation, household-wide history, search, social functionality or clinical summaries are added.

## Local/staging acceptance

1. On an isolated local or explicitly authorized staging database, apply migrations 001–009 in order. Do not reset or seed production. Migration precedes application release when a later deployment is authorized.
2. With owners A/B and two pets in A's household, create backdated notes, milestones, weight entries in lb/kg, and photos. Verify future dates, invalid weights/types/lengths and foreign pet/photo IDs are rejected.
3. Replace a profile photo already used by a journal entry. Confirm the profile changes and the old moment still displays its private image. A journal-only upload must not change the profile photo.
4. Edit and delete moments; deleted items disappear. Simulate a missing test photo and check the fallback and ability to delete the moment. Confirm unauthenticated photo access returns 404.
5. Complete and skip care, then rename the plan: timeline still uses old snapshots; cancelled pending revisions never appear.
6. Check completed/cancelled appointments and external source labels. Verify owner/document/vet vaccination trust, pending/revoked requests and secure document links without private identifiers/notes.
7. Create equal-timestamp events across page boundaries. Check all filters, Load more and Back to latest; no duplicates for unchanged data.
8. Check 390px/mobile, tablet and desktop, keyboard navigation, photo aspect ratio, empty states, long text, and bottom-nav clearance. Confirm provider and login routing stays unchanged.
9. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Hosted full-session concurrency and authenticated browser mutations remain staging acceptance tasks; local SQL tests use isolated PGlite.

## Known limitations and Phase 6C readiness

No immutable timeline event store: source edits/deletions/current trust updates are reflected by the read model. Appointment outcome dates follow the convention above. Cursor paging is not snapshot-isolated across requests. Orphan journal photo cleanup needs an operator process. No historical profile photo picker; choose the current profile photo or upload a journal photo. No weight interpretation/chart, timeline search, household history feed, booking, notification delivery or real vendor integration.

Phase 6C can reuse this normalized contract for pet-specific recent events such as “Jaxson completed heartworm prevention” or “Ellie's vaccination was verified,” with the same snapshot and trust semantics. Add a narrowly authorized bounded household recent-activity query only when Today requires it. Attention/due queries and the notification center remain separate from chronological history. No PetThread Today dashboard is built here.

## Verification recorded for this branch

- `npm run lint`, `npm run typecheck`, `npm run build`: passed locally.
- `npm test`: 146 tests, 143 passed, 3 existing hosted-database tests skipped.
- Isolated PostgreSQL tests apply migrations 001–009 and prove ownership, photo retention, care snapshots, all source mappings, revoked trust, stable ordering, equal-timestamp pagination, filters and privacy. Existing RLS policy definitions are compared before/after migration.
- Browser fixtures checked at 390×844, 768×1024 and 1440×1000: no horizontal overflow, mobile submit clears bottom navigation, active Timeline tab, accessible weight/unit controls, disabled photo submission before selection, and missing-photo fallback. No browser runtime errors. The temporary fixture was removed before the production build.
- Unauthenticated timeline access redirected to login. No authenticated mutations were submitted to the configured remote database. Full staging acceptance and live authenticated upload round trips remain to be run after an authorized staging migration.
