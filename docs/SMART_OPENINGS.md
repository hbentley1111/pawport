# Smart Openings — Phase 5C

Branch: `feature/smart-openings`. Detection and in-app notifications only. No bookings, production polling loop, real vendor calls, email/push delivery, remote migration or deployment is performed.

## Architecture and migration

Apply `supabase/migrations/202609110007_smart_openings.sql` **after migrations 001–006** in an authorized environment. There are three new product tables and one private configuration table:

| Table                           | Purpose                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `availability_watches`          | Immutable household/pet/appointment/connection/creator identity; optional appointment type/service/staff; local date/time/day constraints; captured appointment start; IANA zone; status, expiry and check/match timestamps. Internal revision, processing token, lease and check-error state protect concurrent work. |
| `availability_matches`          | Normalized slot identity and absolute times, first/last observation, detection, state and linked notification. Unique `(watch_id, external_slot_id, starts_at)`. No raw vendor data.                                                                                                                                   |
| `notifications`                 | Private recipient, type, channel, title/body/action URL, read/dismiss timestamps and dedupe key. Phase 5C emits only `availability_match` / `in_app`. Email/push are reserved channel values, not implemented delivery.                                                                                                |
| `availability_runtime_settings` | Private singleton with `demo_enabled=false` by default. Only a trusted database operator can enable it for an isolated local test/demo database.                                                                                                                                                                       |

`provider_connections` gains `availability_supported boolean not null default false`. Existing appointments, mappings, records, reviews and policies are preserved. No new appointment table or availability booking endpoint exists. Existing external appointments remain read-only and manual appointments remain editable.

The schema permits watches without appointments for a future general-availability experience. The current owner UI focuses on earlier openings from a synced appointment. The general RPC path still requires an owned pet, confirmed connection mapping and capability. It does not infer a provider connection from a manual appointment or Google listing.

## Capability and production gates

A new watch requires an active connection, `availability_supported=true`, a confirmed mapping for that pet/household, and (when supplied) the same pet's external appointment on that exact connection. Owner UI and server actions additionally check the server-only adapter registry for an implemented `listAvailability` method and its capability flag. Unimplemented vendor identifiers never enable a CTA.

The worker-only `set_availability_capability` is an attestation point for a trusted worker after validating an adapter; it is not an owner-editable feature switch. The migration enables no capability and provisions no worker login. An operator must configure the first real worker and register a real adapter before live use.

For mock availability, **both** the existing development/test environment guard (`PAWPORT_ENABLE_MOCK_SCHEDULING=true`, NODE_ENV development/test, VERCEL_ENV not production) and the private local database demo opt-in are needed for persisted flows. Production cannot instantiate the mock even when the environment flag is mistakenly set. The operator-only database demo flag is never enabled by a migration or UI action. Demo data is explicitly labeled; normal production owner pages hide mock watches/notifications. Historical non-mock watches remain visible as unavailable if their adapter implementation is absent.

## Watch lifecycle

States: active, matched, paused, expired, cancelled, connection_unavailable.

- Creation captures the original appointment start; a match must precede it. At processing time the earlier of that snapshot and the appointment's current synced start is used. Rescheduling the appointment later never silently broadens the watch to a later cutoff.
- Expiry is the earliest of 90 elapsed days from creation, the end of the requested local date range and the original appointment. Editing cannot extend the original 90-day maximum.
- Appointment cancellation/completion/occurrence, revoked connection, disconnected pet consent, elapsed expiry or passed local date window makes the watch effectively expired. Owner cancellation uses the explicit cancelled state. Neither deletes history.
- Owner pause retains constraints/history and stops processing. Resume requires an available connection. Temporary provider pause/error or missing capability produces connection_unavailable, not cancellation. A processing failure remains visible until a retry succeeds or the owner updates the watch; no success is claimed on failure.
- Effective lifecycle is evaluated during owner reads and worker transactions, and persisted by refresh/sweep functions. PostgreSQL rows do not update merely because clock time passes: without a scheduler, expired state is materialized on access. Reads and processing still prevent expired watches from acting. The future scheduler can invoke `sweep_availability_watches` for unattended maintenance.
- One nonterminal watch per existing appointment is enforced by a partial unique index. Owners can create up to 20 watches per rolling day. Exactly one pet is attached; watch identity cannot be reassigned.

Current edits change the date/time/day preferences and timezone. They do not reassign pet, appointment, connection, creator, original appointment snapshot or external service/staff identity. Recreate a cancelled watch to change those identities through an authorized workflow.

## Normalized AvailabilitySlot and matching

The existing camelCase adapter contract is extended with:

- `externalSlotId`, `connectionId`
- absolute `startsAt`, `endsAt` (end strictly later than start)
- controlled `appointmentType`
- optional `externalServiceId`, `externalStaffId`, `externalResourceId`
- `bookable`

Only this strict shape is accepted; arbitrary metadata and vendor payloads are rejected. Booking context is represented by opaque service/staff/resource IDs internally; a future booking adapter must freshly resolve a slot rather than trusting stored raw metadata. Vendor slot IDs never come from an owner form or appear in browser DTOs.

`lib/openings/matcher.ts` is a pure, vendor-neutral matcher. It requires a future bookable slot from the exact connection, within the expiry and appointment cutoff, local date range, optional start-time window, allowed local weekdays, type and optional service/staff constraints. Weekdays use Sunday=0 through Saturday=6. Day/time preferences use the watch's IANA timezone, never the worker machine's timezone or UTC weekday.

Date and clock boundaries are inclusive; the existing appointment cutoff and expiry are exclusive. Preferred times constrain the **start** of the slot, not its entire duration. Overnight time windows are not supported in this UI; use separate watches in the future. A slot ending after the preferred end time may match if its start satisfies the preference.

The matcher converts absolute instants into local calendar parts, so both valid instances of a repeated DST hour can match; nonexistent wall times are never invented. Same slot ID and equivalent absolute start instant are deduplicated even if offsets differ. The SQL completion function repeats connection, date/time/day/type/service/staff/cutoff/bookability checks as defense in depth.

## Processing and concurrency

`lib/openings/worker.ts` is the server-only entry point. `runAvailabilityWatch(id, rpc)` accepts a trusted watch ID and an injected RPC transport restricted to the existing NOLOGIN scheduling-worker role. No privileged client, secret, public route, cron configuration or production scheduler is created.

1. `begin_availability_check` loads and locks the connection, mapping consent and watch; checks current lifecycle/capability; obtains a two-minute lease and opaque token. A second concurrent attempt returns no work.
2. `processAvailabilityWatch` resolves the generic adapter, checks `supportsAvailability` and `listAvailability`, then queries a UTC envelope covering the entire local date range including DST/non-hour offsets.
3. Validate/normalize up to 100 returned slots and match them using the watch timezone. An adapter must return a **complete snapshot for the requested window**, exhausting its pagination within documented limits. Truncated/partial vendor results must throw instead of falsely marking unseen slots unavailable.
4. `complete_availability_check` reacquires locks and rechecks token, lease, consent, expiry, connection and appointment cutoff. Results from an edited/cancelled watch or superseded/expired lease are discarded. An edit clears the token. Expired/cancelled/unavailable watches cannot create matches or notifications.
5. Match upserts, deduplicated notification inserts, disappeared-slot updates and check/match timestamps commit together. The worker never supplies the notification recipient. Connection outages or invalid adapter output record only unavailable state, not raw error text.

The processor depends only on the generic contract and registry; it contains no vendor names or vendor-specific parsing. It never calls `createAppointment` or `cancelAppointment` and never changes the original appointment.

## Ephemeral availability and deduplication

A match is an observation, not a reservation. UI says “An earlier opening was found,” “Availability can change quickly,” and “Check availability.” Direct booking is explicitly not connected.

Match identity is watch + vendor slot ID + absolute start. Polling the same slot updates last_seen/ends without creating another match. Its notification dedupe key uses the immutable watch and match identity, with a unique recipient/key constraint. The transaction and unique constraints prevent duplicate delivery records.

A complete successful snapshot missing a prior slot marks it unavailable. A failed check also makes existing observations unavailable for UI purposes; it does not claim the vendor cancelled a slot. If the same identity returns, its existing match becomes visible again, but **no second notification is emitted**. Dismissed matches stay dismissed on return. A changed start time is a new identity and may notify once. Expired observations are not revived by ordinary polling. `booked` is reserved for a future verified booking flow; no Phase 5C mutation sets it.

Match detail shows its last observation time and current status. A stale notification may still lead to its historical watch, where availability is qualified. Owners may dismiss a match or separately mark/read/dismiss its in-app notification. Nothing is reserved, guaranteed or automatically reconfirmed by viewing a page.

## Notifications and future channels

Notifications are first-party Pawport records and remain private to the recipient. Only backend processing can insert them. The recipient is derived from the watch's household owner; database guards validate match/notification linkage and prevent recipient/identity reassignment. Browser clients cannot choose titles, recipients, URLs, slot IDs or dedupe keys.

Phase 5C renders an inbox on Openings; home shows a compact summary only for useful current watches. There are no background toasts while the app is closed, email, SMS, browser push or automatic delivery claims. Read/dismiss timestamps refer to in-app state.

Before adding email/push, introduce consent, channel preferences, an outbox/attempt ledger, transactional claiming, idempotency, retries, current-match revalidation, opt-out, delivery monitoring and a provider-specific retention policy. Do not equate an inserted notification with an email sent.

## Owner UX and routes

- `/appointments/[appointmentId]/watch`: supported external appointments only; choose dates, weekday presets and optional start-time bounds. Manual/unconnected appointments offer no Smart Openings CTA.
- `/openings`: current/past watches, recent openings and in-app notifications. Reached from Care; global navigation highlights Care and stays at five mobile destinations.
- `/openings/[watchId]`: private match/watch detail, last-observed status, provider link, dismiss, pause/resume/cancel. `?edit=1` opens preferences for an ongoing appointment watch.
- `/openings/demo`: authenticated local development only, fixed fictional clock and mock slots, no writes. Explicit **Demo availability** label.

Home and pet overview show Smart Openings only when relevant watches exist; one-pet routing remains unchanged. The provider workspace receives no watch visibility. A Google Place ID link goes to the existing service detail; otherwise “View provider connection” leads to the private status page. Neither action books nor asserts live availability. User must confirm details with the provider.

The UI exposes normalized preferences and slot times only. No credentials, external customer IDs, slot IDs, leases or raw responses are sent to the browser. The private connection UUID used in server context is not passed into the watch form; creation derives it again from the owner's appointment.

## Security and regressions

All new tables enable RLS and deny direct reads/writes to browser roles. Safe owner DTO RPCs scope to authenticated watch creator/recipient; watch creation derives the household from an owned pet and checks confirmed connection association and appointment identity. Provider scheduling grants do not grant access to household watches.

Owner RPCs: save watch, set pause/resume/cancel, dismiss match, mark/read/dismiss notification. Worker-only RPCs: attest capability, begin/complete check, lifecycle sweep. Internal functions and triggers revoke default PUBLIC execute. Existing RLS and SECURITY DEFINER functions from phases 1–5B are not replaced.

No Google content is copied. Only the existing Place ID may appear in a provider link. No vendor SDK, secret, endpoint, business scraping or medical-record integration is added.

## Verification and manual acceptance

Run Node 22+:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

PGlite tests apply migrations 001–007 in an isolated in-memory database, preserve snapshots of old appointment data and policies, explicitly enable demo capability for that fixture only, and exercise owner creation, spoof denial, immutable identity, worker-only matches/notifications, dedupe, disappearance/return, dismissal, stale results, connection lifecycle and expiry. Matcher tests include timezones, DST folds/gaps, weekdays/weekends, earlier cutoff, service/staff, duplicate and non-bookable slots. Existing regression tests remain intact.

For local demo viewing, set `PAWPORT_ENABLE_MOCK_SCHEDULING=true` in a development environment and open `/openings/demo` while signed in. This page does not require the new database migration or create actual watches. For the full persisted local test path, run `tests/openings-database.test.ts`; it explicitly seeds only its isolated PGlite fixture and uses the generic processor/mock. Do not enable the database demo flag or seed fixtures remotely as part of this task.

Before a later authorized staging/production release:

- [ ] Apply migration 007 after 006 to isolated staging, then release the matching code. Retain all existing tables and histories on rollback.
- [ ] Verify no live CTA appears with no implemented adapter; production cannot instantiate mock even with its environment flag.
- [ ] An owner can watch only their confirmed mapped pet and compatible appointment. Another owner, verifier, scheduling manager and anonymous role cannot read or mutate those watches/notifications.
- [ ] Create/edit preferences, pause/resume/cancel; effective expiry occurs by 90 days or earlier cutoff. Dates/times show the watch timezone.
- [ ] Process complete mock snapshots: same slot twice, missing slot, returning slot, newer start, non-bookable slot; confirm notification counts and dismissal behavior.
- [ ] Edit/cancel during an in-flight request; expired token cannot create a notification. Pause/revoke connection or disconnect pet mapping; processing stops without deleting history.
- [ ] Check local midnight, DST gaps/folds, both sides of an appointment reschedule, and earlier-than cutoff equality.
- [ ] Check mobile 390px, tablet and desktop; forms/notifications remain clear of fixed nav; keyboard controls and labels are usable.
- [ ] Existing manual edit/cancel, external read-only appointment, ICS, records, reviews, share links and provider verification remain unchanged.

## Future scheduler, limitations and Phase 5D

No recurring scheduler or public processor endpoint is installed. A future Vercel Cron, Supabase scheduled job, queue or verified availability webhook may call the same worker entry point. It must select eligible watch IDs with bounded concurrency, provider-aware rate limits, jitter/backoff, timeouts, lease recovery, monitoring and a reasonable cadence. Grouping compatible watches into one provider query can reduce future API cost, but must preserve consent checks and complete-snapshot semantics per watch.

This foundation caps one snapshot at 100 slots and watch life at 90 days. It has no continuous checks or automatic notifications outside Pawport. The beta owner read model currently retrieves watch/notification history together; introduce indexed pagination and bounded history projections before enabling high-volume live polling. No whole payload retention, external service catalog selection, overnight preference window, notification delivery or live booking is implemented. Hosted staging acceptance still requires separate authorization and credentials.

Phase 5D can use this identity and capability foundation for: owner selects Check availability → resolve the slot privately → freshly query the adapter → verify the slot and service/staff/resource choices → show pricing/deposits/cancellation policies → explicit owner confirmation → idempotent provider booking API only if `supportsAppointmentCreate` → verified booking result → reconcile the appointment and match. A recheck or notification is never booking consent. Handle slot races, retries, partial failures and original-appointment cancellation as distinct authorized operations. None of these booking steps is implemented in Phase 5C.
