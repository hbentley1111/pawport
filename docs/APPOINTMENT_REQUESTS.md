# Appointment Requests — Phase 8A

Pawport connects an owner's request with a human business response. This is **request → human response → confirmation**, not real-time inventory, instant booking, or a vendor booking. Nothing is booked until the appointment is confirmed. A claimed business remains distinct from a medically credentialed veterinary provider.

## Migration and rollout

Apply `202609110014_appointment_requests.sql` only after migrations 001–013, first to a disposable/local or separately approved staging database. This implementation does not apply migrations remotely, merge, deploy, configure a cron, or send email/SMS.

Existing services receive `accepts_appointment_requests = false`. No location starts accepting requests automatically. No new secrets or Google APIs are required. A later authorized release should apply the additive migration before releasing the application, verify inactive defaults, then let businesses explicitly enable intake. Existing application functions retain their grants and behavior.

## Data model

| Table | Purpose and limits |
| --- | --- |
| `service_provider_request_settings` | One location; disabled by default; instructions ≤1000; notice 0–336 hours; advance 1–180 days. |
| `appointment_requests` | One immutable owner/household/pet/location/service/contact/timezone identity; current proposal and unique canonical appointment reference; seven-day lifetime. Contact name ≤120, phone ≤40, note ≤1000. |
| `appointment_request_windows` | One to three immutable preferred windows; positions 1–3; each 30 minutes–8 hours, future, nonoverlapping, within intake notice/advance limits. |
| `appointment_request_proposals` | Provider's exact proposed time, message ≤500, snapshot timezone, bounded expiry; one pending proposal per request; previous proposals retained. At most 50 proposals per request. |
| `appointment_request_events` | Append-only lifecycle events with actor retained privately and safe owner-visible messages. No medical history is copied here. |

`service_provider_services.accepts_appointment_requests` is an operational toggle, separate from service activity and profile editing. The existing notifications table gains type `appointment_request_update` and `appointment_request_id`; existing care, opening, appointment-reminder and verification integrity checks remain.

Indexes cover owner/date cursor pagination, location/status/date inbox queries, the partial unique open-request identity, one pending proposal, and request history ordering. No medical indexes or policies are changed.

## Intake and roles

Public intake is available only for active organizations and locations, a published location profile with a valid PostgreSQL IANA timezone, enabled settings, and at least one active requestable service. The public RPC returns only business-provided names, instructions, timezone, request limits and requestable service descriptions/IDs.

Owner/admin/scheduling_manager may configure intake and respond, only for locations allowed by Phase 7C's `service_provider_can_access_location`. Staff have read-only request access for their assigned locations. Scheduling managers still cannot edit business profiles merely because they can configure requests.

Disabling intake, unpublishing a profile, or deactivating a service prevents new requests. Existing requests can still be handled while the organization/location remain active. Suspension blocks business reads/actions and new confirmations, including owner proposal acceptance. Owners can still view, withdraw, or cancel their own requests.

## Owner submission and privacy

`/appointments/request?locationId=…` uses the owner's household pets and live requestable services. Before submission the owner explicitly acknowledges sharing pet name/species, contact information, preferred times and the note. `contact_email` comes from the current **confirmed Supabase Auth email**, through `bd_auth_email`; browser email, owner ID and household ID are never accepted. Name and optional phone/note are user-entered.

Limits are 20 submissions per owner per rolling day, 10 open requests, and one open request per owner/pet/location/service. Owner advisory locking serializes the limit checks; a partial unique index also enforces the open-request identity. Expired open rows are retired with history before new submission checks.

Business request DTOs contain only pet name/species, the submitted contact snapshot/note, service/business labels, preferred times, proposal, status, safe appointment time/status, expiry and normalized history. They omit pet UUIDs, owner/auth/household IDs, health documents, vaccinations, timelines, care routines, other pets, Smart Opening watches, and integration internals. Actor IDs stay in the private event table. Business profile and claim information are not substituted for owner contact.

## Timezone and DST

The location profile's IANA timezone is snapshotted at submission. Request windows and proposals are stored as absolute `timestamptz` instants and rendered in that stored timezone, even if the business later changes its profile timezone.

Server actions fetch the authorized intake/request timezone; they never use a browser-supplied schedule zone. They reuse `lib/care/time.ts`: nonexistent spring-forward local times are rejected; repeated fall-back times choose the earlier occurrence, explicitly explained in the form. The UI accepts minute precision. Database validation independently enforces finite instants, duration, notice, horizon and ownership. Direct RPC callers supply explicit instants, not unzoned local wall times.

## Lifecycle and consent

- `requested`: waiting for the business.
- `provider_proposed`: a pending alternative awaits owner consent.
- `confirmed`: linked to one canonical Pawport appointment.
- `declined`, `withdrawn`, `cancelled_by_owner`, `cancelled_by_provider`, `expired`: closed history.

Direct confirmation requires the exact start/end to fit entirely inside **one** submitted preferred window. Otherwise the provider must propose a time. A proposal is future, at most eight hours long, inside the maximum advance horizon, and expires at the earliest of 48 hours, request expiry, or its start time. A new proposal supersedes the old pending proposal transactionally.

Owners accept only the current, pending, unexpired proposal. Declining a proposal returns an unexpired request to waiting. Withdrawal closes the request and its pending proposal. Provider decline is terminal and may include a neutral owner-visible reason. There is no editing of request identity or contact snapshots after submission.

Reads present requests past their seven-day expiry as expired without requiring a worker. Expired proposals appear expired and their still-live request returns to waiting in presentation. A provider may propose again. `expire_appointment_requests(limit)` performs bounded physical expiry and appends history; only the existing restricted `pawport_appointment_worker` role may execute it. There is no browser endpoint or production cron.

## Canonical appointments and reminders

`ar_create_appointment` is internal-only. A successful direct confirmation or proposal acceptance creates one existing `appointments` row:

- `source = pawport`, `status = confirmed`;
- household/pet and `created_by` come from the request owner;
- provider name and title come from Pawport business organization/service data;
- appointment type maps emergency_veterinary→emergency_vet, walking→walker, sitting→sitter, retail→other; other supported categories retain their corresponding type;
- Google Place ID uses the existing claimed-location linkage;
- optional address is built only from business-entered location profile fields;
- timezone comes from the request snapshot.

The same transaction creates existing in-app appointment reminders at 1440 and 120 minutes, links the appointment, updates request/proposal status, appends history, and emits any required owner notification. No appointment or reminder table is duplicated. Existing reminder workers, ICS export, Today and appointment history continue to consume canonical records. Today and Timeline distinguish “Confirmed through Pawport” from external synchronization and owner-entered manual appointments.

Request-created appointments remain read-only in the ordinary appointment editor. The owner follows the request-management link to cancel. Manual appointments remain editable, and externally synced appointments retain their provider-managed behavior.

## Cancellation

Owner and authorized provider cancellation update only the request's linked `pawport` appointment from confirmed to cancelled, and append the corresponding event. Provider cancellation also emits an owner notification. A request cannot be relinked to a different appointment after confirmation. Manual/external/unrelated appointments cannot be cancelled through this path.

Post-confirmation rescheduling is not implemented: cancel and submit a new request. No cancellation is sent to an external vendor. Appointment completion/history workflows remain those of the canonical appointment system; this phase does not add a business completion control.

## Notifications and current state

Existing in-app notifications handle provider proposals, direct confirmations, declines and provider cancellations. Deterministic keys are:

- `appointment-request:{request}:proposal:{proposal}`
- `appointment-request:{request}:confirmed`
- `appointment-request:{request}:declined`
- `appointment-request:{request}:provider-cancelled`

A database trigger verifies request recipient, subject pet and action URL. Identity fields remain immutable. Owner acceptance is already an explicit owner action and does not emit a redundant confirmation message. Prior proposal messages remain history; their destination always shows the current request/proposal state.

Notification Center reuses its existing pagination/read/dismiss behavior. Unconfirmed requests do not become duplicate Today cards. Confirmed appointments naturally appear in Today, Appointments and reminders. No emails, SMS, vendor alerts or provider notification infrastructure are added.

## UI and routes

- `/appointments/request`: owner form with 1–3 preferred windows and explicit sharing consent.
- `/appointments/requests`: waiting, proposal, confirmed and closed sections.
- `/appointments/requests/[requestId]`: response/proposal, owner actions, appointment link and history.
- `/provider/businesses/[organizationId]/requests`: location-scoped inbox and per-location settings/service toggles.
- `/provider/businesses/[organizationId]/requests/[requestId]`: safe shared details and role-aware provider actions.

Lists use stable `(created_at DESC, id DESC)` cursor pagination, 25 records per page. Group headings apply to the current page. Request history is bounded to the latest 100 events. Forms have labels, validation feedback, pending states and explicit confirmation for destructive lifecycle actions. Provider dashboard locations show only new/waiting-on-owner counts and link to their scoped inbox.

Published public business profiles and Local Services display Request appointment only when intake is available. The appointment list links to request management. Google listing data stays visually and architecturally separate from Pawport business-provided content.

## Security and races

All five new tables have RLS enabled, with direct browser and inherited service-role grants revoked. Internal helper functions are revoked from PUBLIC/anon/authenticated/service_role. Only explicit narrow RPCs are exposed. No permission policies are added to medical, review, integration or owner-care tables.

Provider transitions lock the organization through the existing authorization helper before locking the request. Owner transitions use the same organization→request lock order and recheck owner/status/expiry under lock. Proposal changes and appointment creation happen inside that transaction. Partial unique indexes and the immutable unique appointment link backstop idempotency. Repeating the accepted confirmation returns the same appointment. Losing withdrawal/cancellation/supersede attempts are rejected once a conflicting terminal transition wins.

Local PGlite tests exercise repeated queued calls and both serial orderings of competing transitions. **PGlite uses one database connection; this is not a substitute for genuine two-session PostgreSQL race testing.** Before release, use two independent staging sessions with authenticated role/JWT context and concurrent calls for:

1. direct confirmation versus owner withdrawal;
2. owner acceptance versus proposal supersession;
3. duplicate provider confirmation;
4. duplicate owner acceptance;
5. provider versus owner cancellation.

Assert one valid terminal outcome, one canonical appointment, exactly two reminder rows, and one message per deterministic notification identity. No remote staging mutation was performed during implementation.

## Trust separation

A business receiving a veterinary-category request gains no medical authority. No `veterinary_providers`, medical `provider_memberships`, verification queue access, or health-document permission is created. Generalized scheduling managers gain only request-management permissions; there is no automatic `provider_scheduling_permissions`, credential access, connector mutation, sync worker authority or Smart Openings activation. Community reviews and reviewer privacy remain independent.

## Manual acceptance checklist

1. In separately authorized staging, apply migrations through 014; verify old service flags are false.
2. Use an active claimed business with a published profile, IANA timezone and at least one active service. Enable requests and mark a service requestable.
3. Verify public-profile and Local Services CTAs. Disable intake, unpublish/suspend the location, remove its timezone or unmark all services: the public CTA must disappear.
4. With a confirmed-email pet owner, submit 1 and 3 nonoverlapping windows. Reject invalid durations, insufficient notice, excessive horizon, DST gaps and foreign pets.
5. Confirm inside a preferred window. Verify the owner-created canonical `pawport` appointment, two reminder rows, request event and notification.
6. Try confirmation outside preferences; use a proposal instead. Verify owner accept, decline, supersession and expiry.
7. Test withdrawal, provider decline and both cancellation paths. Closed requests remain visible; original manual/external appointments are unaffected.
8. Use owner/admin, scoped scheduling_manager, scoped staff and unrelated accounts. Check read-only staff behavior and rejection outside assigned locations. Removed/suspended memberships lose access.
9. Inspect browser DTOs: no medical/private owner IDs or connection internals. Notification recipients cannot be spoofed.
10. Verify Today, Notification Center, appointment ICS/reminders and Timeline cancellation labels. No duplicate request message is added to Today.
11. Complete the two-session race checks above and keyboard/mobile checks at 390px, 768px and desktop widths.

## Automated validation

`tests/appointment-requests-database.test.ts` executes the actual migration chain in local PGlite with Supabase-style roles/Auth/Storage fixtures. It covers intake defaults, role/scope denial, contact identity, limits/windows, confirmation/proposals/withdrawal/cancellation/expiry, appointment/reminder idempotency, notification integrity, immutable history, dashboard counts and trust separation.

`tests/appointment-requests.test.ts` covers input bounds/email-spoof rejection, timezone/DST conversion, safe render text, request copy, empty state and client/server trust boundaries. Existing provider-dashboard migration tests retain their pre-013 compatibility fixture, then apply later additive migrations before their unchanged permission assertions.

Regression commands: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`. Run build before the full test suite so the existing client-bundle secret scan has current output. Browser verification uses a temporary synthetic component fixture removed before the production build; no remote requests are submitted.

## Limitations and future readiness

No live vendor availability, instant booking, vendor-side appointment creation/cancellation, post-confirmation rescheduling, owner/provider chat, email/SMS alerts, production expiry cron, payments, deposits or medical recommendations. Providers respond manually in the inbox. Concurrent real PostgreSQL staging acceptance remains necessary.

Phase 8B can attach real adapter availability/reconfirmation/booking to the existing canonical appointment model, with distinct inventory consent and vendor identity. This phase does not call `listAvailability()` or any booking adapter. Phase 8C can later connect cancellations, Smart Openings and rebooking with explicit consent; none is automatically activated here.

## Implementation validation results — 2026-09-12

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, including all five new dynamic request routes. Temporary visual fixture removed before build.
- `npm test`: 231 tests total; 228 passed, 3 existing hosted-environment tests skipped, 0 failed. The new request suites contribute 26 tests including nested database scenarios.
- Actual request components inspected at 390×844, 768×1024 and 1440×1000: no horizontal overflow; business timezone, consent and role-aware controls visible. Preferred-window expansion checked with synthetic data. Browser console reported no application errors.
- Remote migrations, authenticated staging transactions, independent-session PostgreSQL races, deployments and vendor calls were not performed.
