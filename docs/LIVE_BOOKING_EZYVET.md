# Live booking with ezyVet — Phase 8B

PetThread can execute the real ezyVet **sandbox** availability and booking workflow through a protected scheduling worker. This branch does not enable production booking, deploy a function, apply a remote migration, or install credentials. All automatic tests use fake HTTP transports and sanitized structural fixtures.

Appointment Requests remain the human-confirmed fallback. Live booking means an actual vendor appointment was created after explicit owner confirmation; a request means a business still needs to respond. Availability is never a reservation.

## Vendor contract and certification

ezyVet is the first adapter because this phase explicitly selects it, not because business claiming proves veterinary credentials. Reviewed against the current official reference on September 12, 2026:

- [OAuth](https://developers.ezyvet.com/#get-token): `POST /v1/oauth/access_token`, JSON partner/client credentials, `grant_type`, vendor-supplied `scope`, and `site_uid`. No scopes are invented or hardcoded.
- [Current availability](https://developers.ezyvet.com/#get-calendar-availability): `GET /v4/calendar/availability`. Maximum five resources and seven dates per call; duration 10–360 minutes in five-minute increments. The deprecated ezyCAB availability endpoint is not used.
- [Booking](https://developers.ezyvet.com/#create-booking): `POST /ezycab/booking`, with documented `startTime`, `type`, `durationMinutes`, `appointmentStatus`, `animal`, `contact`, and `provider`. Success must contain a booking request ID and appointment UID.
- [Booking guidance](https://developers.ezyvet.com/guides/booking.html): use the booking workflow rather than constructing a bare appointment.
- Catalog: `/v3/siteInformation`, `/v2/appointmenttype`, `/v2/resource`.

The adapter is deliberately hardwired to `api.trial.ezyvet.com` and the distinct booking host `apiv2.trial.ezyvet.com`. Production hosts are absent. A later reviewed change, commercial permission, sandbox evidence, and applicable certification are prerequisites for production. OAuth success never enables `booking_supported`.

Parsers require documented structural fields and discard irrelevant fields. Unknown shapes fail closed. The resource endpoint does not document pagination parameters in its endpoint contract; this version sends only `active=true` and rejects a multi-page response rather than guessing pagination semantics. Appointment-type pagination is bounded to 20 pages. Large resource catalogs need vendor clarification before support is expanded.

## Architecture and execution boundary

`supabase/functions/_shared/live-booking/` contains the generic live adapter contract, strict parsers, credential resolver, ezyVet transport, worker pipeline, and HTTP handler. `scheduling-live-booking/index.ts` binds them to protected Edge environment secrets and narrowly granted database RPCs. The existing `SchedulingAdapter` has an optional privileged `liveBooking` contract; the ordinary Next.js mock registry remains unchanged and production-disabled.

The browser calls the Edge Function using its Supabase bearer JWT and public project key. The worker validates the token through Auth's `/auth/v1/user`; confirmed email is required. It never accepts a browser user ID. Exact configured origins are required, responses are private/no-store, and action objects reject extra fields. The allowed actions are `availability`, `book`, `provider_catalog`, and authenticated `intake`.

**There is no service-role key or vendor credential in the Next.js application.** Only the Edge entry point reads `SUPABASE_SERVICE_ROLE_KEY`. It uses an allowlist of internal RPCs rather than direct table writes. Browser roles cannot execute those RPCs. The service role cannot execute the new operator capability functions.

## Credentials and token cache

`credential_ref` is an opaque name matching `EZYVET_CONNECTION_[A-Z0-9_]{1,64}`. The resolver refuses other names before reading the environment. The corresponding protected Edge secret contains JSON with `partner_id`, `client_id`, `client_secret`, `scope`, `site_uid`, and optional `grant_type=client_credentials`.

No actual secret belongs in SQL, a public table, a profile, a form, a fixture, or a commit. No credential setup was performed in this phase. The resolver does not read arbitrary environment variables. Process-local adapters cache OAuth tokens, share an in-flight token request, refresh before expiry, and refresh once following a GET 401. A digest of the secret distinguishes rotations in the bounded process cache. Tokens and raw payloads are never logged or returned.

Every vendor request has an abort timeout. Catalog/availability GETs have at most one transient retry. Booking POSTs have no automatic retry. Response bodies are bounded; strict normalized projections prevent vendor private data from entering owner DTOs.

## Additive schema

Migration: `supabase/migrations/202609110015_live_booking.sql`, after migrations 001–014.

| Model                            | Purpose                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_connections` additions | `booking_supported` defaults false; operator verification and runtime validation timestamps, vendor timezone, bounded validation error |
| `live_booking_runtime_settings`  | Singleton sandbox switch, default false; trusted operator only                                                                         |
| `service_scheduling_bindings`    | One immutable service/connection identity, vendor appointment type, duration, resource mode, active/paused, explicit enablement        |
| `service_scheduling_resources`   | Selected resource UIDs per binding; optional internal display label                                                                    |
| `live_booking_quotes`            | Owner/pet/service/location/mapping-bound slot snapshots with deterministic fingerprint and maximum five-minute expiry                  |
| `live_booking_attempts`          | One attempt per quote, unique idempotency key, durable state and minimal vendor/local appointment identity                             |
| `live_booking_events`            | Append-only normalized operational events; no raw payloads or contact identities                                                       |
| `appointments.booking_origin`    | Nullable immutable `pawport_live`, valid only for external ezyVet appointments                                                         |

The existing external appointment state version becomes nullable to represent an **unset** cursor, rather than inventing a vendor version. Existing non-null cursors and importer ordering rules remain intact. No second appointment or mapping table is created.

All new tables have RLS enabled and direct browser access revoked. RPCs explicitly project safe data. New indexes support owner quote lookup/expiry, fingerprints, daily attempts, and bounded request-rate lookups. No speculative indexes were added to medical tables.

## Business configuration and permissions

Configuration requires both active owner/admin/scheduling-manager business membership with location access **and** active `provider_scheduling_permissions` for that connection. Staff cannot configure. The Phase 7C location predicate delegates to one shared internal implementation for JWT and worker contexts. Business membership never creates integration permission.

`/provider/businesses/[organizationId]/live-booking` offers accessible-location switching, safe capability/status information, catalog validation, and service mapping. Authorized managers choose an appointment type, 10–360 minute duration, one to 25 selected resources, and explicit service enablement. A service cannot bind across Place IDs or silently move to another connection. Other members receive read-only status without connection IDs, resource IDs, or credential references.

Only `pawport_scheduling_worker` may call `set_booking_capability` or `set_live_booking_sandbox_enabled`. Validation does not grant booking capability. Credential/account/location changes reset capability approval. Provider dashboard location cards link to this status/configuration page; it shows enabled-service counts and timezone mismatch information. It does not expose customer lists, mappings, watches, or owner appointments.

The schema permits resource mode `all`, but this implementation only configures and executes **selected** resources. Future all-resource support needs explicit vendor and provider review.

## Eligibility and public presentation

Execution requires an active published organization/location, valid profile timezone, active service and enabled binding, active ezyVet connection, availability and booking capabilities, valid credentials, successful live catalog/availability validation, and a confirmed mapping with both animal and contact IDs. No contact or animal is created automatically.

Authenticated intake additionally requires at least one eligible owner pet mapping. Anonymous pages make no live capability claim. Public profile and Local Services retain Appointment Requests; a signed-in eligible sandbox user may see **Sandbox live booking available** after live validation. No badge is inferred merely from database capability bits. Intake checks at most the first five candidate services; larger catalogs need pagination before expansion.

Owner route: `/appointments/book?locationId=…&serviceId=…`. The owner chooses their pet/service, checks the next seven business-local dates, selects a quote, reviews it, and explicitly confirms. Missing mapping, unavailable connection, or no slots offers Request Appointment when intake is configured. Google listing content remains separate from provider-owned data.

## Availability and timezone normalization

The vendor site timezone is authoritative. The site-information timezone relationship must resolve to a valid IANA name. A mismatch with the PetThread profile is reported to managers; it is never silently interpreted in the profile timezone.

V4 rows provide a local date and slot time with an offset. The parser combines those **vendor-provided** values, checks the resulting local clock/date against the IANA zone, and produces absolute timestamps. It rejects inconsistent offsets/nonexistent spring times; repeated fall-back times retain their distinct offsets. Seven dates are calculated as local calendar dates rather than seven UTC midnights.

Resources are batched in groups of five, with at most 25 configured resources. Equal service/start/end slots collapse to one deterministic resource (lexicographically greatest UID). The browser never sees that UID. Quotes return only `quoteId`, `startsAt`, `endsAt`, `timeZone`, and `expiresAt`. At most 100 quotes are returned/active per user. Availability/catalog requests are database-limited to 20 per user per minute per operation class.

## Booking state machine and races

1. `begin_live_booking` serializes per owner, locks/revalidates the quote and current eligibility, and creates the only attempt for that quote. Maximum ten attempts per owner/day.
2. The worker fetches current catalog and **re-queries the exact resource/date/type/duration**, requiring identical absolute start/end and timezone.
3. `reconfirm_live_booking` checks eligibility and binding freshness again before allowing the POST.
4. Missing slot becomes `slot_gone`; no booking POST occurs.
5. A successful POST response is strictly parsed and its appointment UID is durably recorded before canonicalization.
6. `complete_live_booking` creates/links the canonical appointment, state, alias, and existing 24-hour/two-hour in-app reminders transactionally.

Quote states: available → booking → booked / slot_gone / failed / unknown; available quotes expire lazily. Attempt states: initiated → availability_reconfirmed → vendor_confirmed → completed, with terminal slot_gone / failed / unknown alternatives. Histories are retained.

Repeat clicks cannot dispatch another POST: the unique quote attempt and owner advisory lock return completed, unknown, or a database-only finalization path. A fresh quote for the same pet/connection/time cannot bypass an uncertain or completed attempt. Binding snapshots, ownership checks, connection/mapping locks, and unique external identities protect race boundaries. Eligibility is checked immediately before dispatch; there is necessarily no database transaction spanning the vendor network call.

## Ambiguous outcomes and recovery

Timeout, network loss after dispatch, 5xx, redirect, or malformed success is **unknown**, with no confirmed local appointment and no automatic POST retry. Definite authentication/rate/validation rejection uses bounded error codes. If local persistence fails after a parsed vendor success, the owner also receives unknown language.

If the vendor UID was durably stored, a repeated call may finish database canonicalization without a new POST. If the worker crashes before storing the response, initiated/reconfirmed attempts also block another POST. Unknown outcomes require an operator to verify the actual vendor appointment before any further action. No public reconciliation or “retry booking” endpoint is provided. The owner is told to contact the provider to verify status, not that an appointment is reserved.

Production requires a tested reconciliation runbook and monitoring before enablement; those operational workflows are not configured here.

## Canonical external appointments and existing features

Successful bookings use source `external`, system `ezyvet`, `booking_origin=pawport_live`, status `confirmed`, sync state `current`, and the owner's household/pet/created-by identity. Provider name, service title, and address come only from PetThread provider-entered records. Google contributes only the existing Place ID relationship.

The returned vendor appointment UID is registered in `external_appointment_state` and `external_appointment_aliases`, using the same connection-first lock as imports. If sync arrived first, completion reuses that appointment and preserves its newer authoritative fields. Otherwise the cursor starts NULL so the next real sync can advance it. This prevents duplicate appointments.

Appointments and PetThread Today pick up the normal confirmed appointment. Completed/cancelled outcomes later flow through the existing timeline. Care cards identify bookings through PetThread. These external appointments remain provider-managed: **Contact the provider to cancel or reschedule.** No local-only cancellation, vendor cancellation, or vendor rescheduling was added.

## Privacy and trust

Booking sends only the confirmed vendor animal/contact identities, appointment type/resource, and time/duration. It never sends documents, vaccinations, care plans, journal, timeline, or household IDs. Owner/public DTOs omit connection IDs, resource/type UIDs, external animal/contact IDs, credential references, and OAuth tokens. Provider catalog IDs are returned only to explicitly authorized integration managers.

Business claiming, profile publication, scheduling, and veterinary verification remain separate. No veterinary providers, provider memberships, verification authority, health-record access, review powers, or automatic scheduling permissions are created. Other vendors and mock adapters cannot execute this live pipeline.

## Local validation and staging acceptance

- Run `npm run lint`, `npm run typecheck`, `npm run build`, then `npm test` (the suite checks the fresh client bundle for secrets).
- Edge validation: `deno check --config supabase/functions/deno.json supabase/functions/scheduling-live-booking/index.ts`.
- Tests use PGlite with the complete migration chain, actual RPCs/roles, and fake vendor transport. No vendor or remote database is contacted.
- In a disposable staging environment only, apply migrations in order through 015; deploy/configure the worker only after separate authorization.
- Configure exact allowed sandbox origins, `PAWPORT_SCHEDULING_ENV=sandbox`, `PAWPORT_EZYVET_SANDBOX_ENABLED=true`, and a protected credential secret. Default configuration does nothing.
- A trusted operator separately enables the sandbox switch and approved connection capability. Give only designated integration managers explicit scheduling permissions.
- Verify mapped/unmapped pets, disabled requests, unavailable connection, timezone mismatch, empty slots, expired quote, slot disappearance, success, ambiguous timeout, and request fallback.
- Use two real PostgreSQL sessions to test simultaneous begin, binding edit/reconfirm, connection pause, sync-before-completion, and two completion calls. PGlite exercises transactional invariants but is not a substitute for independent-session load testing.
- Verify mobile 390px, tablet, desktop, keyboard focus, labels, and private/no-store responses. Check owner and scoped manager sessions independently.

## Production enablement checklist

Every applicable item is required. **This branch cannot reach production hosts even if environment flags are changed.**

- [ ] ezyVet commercial partnership/API approval
- [ ] Sandbox credentials installed securely
- [ ] Required vendor-issued scopes confirmed
- [ ] Sandbox availability validation completed
- [ ] Sandbox booking validation completed
- [ ] Certification/pilot requirements complete
- [ ] Reviewed production-host/runtime change approved
- [ ] Production credential installed in privileged runtime
- [ ] Provider connection validated
- [ ] Pet/contact mapping workflow validated
- [ ] Appointment type/resource mappings reviewed
- [ ] `booking_supported` enabled by trusted operator
- [ ] Business explicitly enables each service
- [ ] Monitoring and reconciliation runbook ready
- [ ] Independent-session race tests and sandbox end-to-end acceptance pass

## Limitations and Phase 8C readiness

Local validation on September 12, 2026: lint, Next.js typecheck, production build, and Deno Edge check passed. The complete suite reported **258 passed, 3 existing hosted-integration tests skipped, 0 failed** (30 additional live-booking tests including nested database cases). Browser fixture checks passed at 390px, 768px, and 1440px with no horizontal overflow; radio keyboard selection worked and the final content cleared the fixed mobile navigation. The temporary UI fixture was removed before the production build. No authenticated vendor end-to-end booking was attempted.

No sandbox credentials or partner access were supplied, so actual vendor acceptance remains unverified. Fixtures validate the documented contract, not partner-specific behavior. No production enablement, cron, email/push/SMS, payments, automatic identity creation, vendor rescheduling/cancellation, or automated reconciliation is implemented. Resource pagination and all-resource mode are deferred. Public live claims require a signed-in mapped sandbox owner; anonymous visitors retain requests. Service discovery is bounded to five checked live candidates and 100 returned slots.

Phase 8C can build connected cancellation/rescheduling, explicit Smart Opening booking after reconfirmation, cancellation-generated openings, and reconciliation on the canonical external identity and durable attempt/event model. Nothing in this phase automatically books a Smart Opening or treats availability as guaranteed.
