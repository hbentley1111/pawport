# Connected appointment operations — Phase 8C

Pawport asks the provider's scheduling system to make a change. It displays cancellation only after vendor success or conclusive reconciliation. Scheduling never grants medical-record access or verification authority.

**Implemented:** sandbox connected cancellation, durable mutation history, read-only reconciliation, cancellation-triggered availability rechecks, and a restricted real-availability watch processor. **Unsupported:** connected rescheduling and Smart Opening moves. The current vendor contract does not establish the required reschedule fields. Those actions fail closed, including direct API calls; there are no fake reschedule controls or local-only changes.

## Verified ezyVet contract

Reviewed September 12, 2026 against the current [ezyVet Appointment Management reference](https://developers.ezyvet.com/#update-appointmentv2) and its published OpenAPI operation. The relevant operation is `PATCH /v2/appointment/{id}`, with a **numeric appointment ID**, `write-appointment` scope, and `Content-Type: application/merge-patch+json`.

The documented cancellation body is:

```json
{ "cancel": true, "cancellation_reason_text": "Cancelled through Pawport" }
```

The contract accepts cancellation with `cancel: true` plus a cancellation reason ID or text. Pawport uses only the documented text alternative. It does not guess a status ID or send `active: false`. The parser requires HTTP 200 and exactly one `items[].appointment` with the expected numeric `id`, expected `uid`, and `active: false`. Malformed or unexpected success responses are **unknown**, not successful cancellation.

The other documented PATCH inputs are `cancellation_reason`, `status_id`, `description`, `animal_id`, and `consult_id`. **The operation does not document start, end/duration, resource, or appointment-type update inputs.** Response fields are not permission to use them as mutation inputs. Rescheduling remains unsupported until ezyVet supplies an authoritative update contract, response semantics, and sandbox acceptance evidence. No cancel-and-rebook workaround is implemented.

Reconciliation uses [the current calendar endpoint](https://developers.ezyvet.com/#get-calendar-appointments): `GET /v2.1/calendar/appointments`, filtered with `filter[id][in]` and `pageSize=1`. The numeric ID is first resolved from documented `GET /v2/appointment?uid=...`; an appointment UID is never placed in the numeric ID filter. The calendar request omits the active filter so it can observe cancellation. The documented calendar `active: false` state represents cancellation. Missing rows, additional rows/pages, identity mismatches, or malformed data are inconclusive.

Strict internal normalization retains only appointment identity, active state, absolute start/end, resource/type IDs, animal/contact IDs, and vendor `modified_at`. These are never owner DTO fields. The calendar duration is seconds; availability binding duration remains minutes.

Availability continues to use **`GET /v4/calendar/availability`**. New code never uses the deprecated availability endpoint. Creation remains the Phase 8B `POST /ezycab/booking` path.

## Persistence and authorization

Migration: `supabase/migrations/202609110016_connected_appointment_operations.sql`.

| Table                              | Purpose                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live_booking_appointment_links`   | Immutable canonical appointment → successful attempt/quote/service/binding/connection/mapping association. Backfilled from eligible completed Phase 8B attempts; future completion attaches a link transactionally. |
| `live_appointment_mutations`       | Actor, operation, expected canonical timestamps/version, vendor identity, bounded status/error, dispatch marker and reconciliation lease.                                                                           |
| `live_appointment_mutation_events` | Append-only normalized lifecycle events without raw payloads or tokens.                                                                                                                                             |
| `live_reschedule_quotes`           | Reserved private five-minute quote schema. No quote writer or usable reschedule flow exists while the contract is unsupported.                                                                                      |
| `availability_recheck_requests`    | Leased connection/service/date-window rechecks following actual cancellation. Contains no watcher list or fabricated inventory.                                                                                     |

All new tables have RLS enabled and direct browser access revoked. Narrow SECURITY DEFINER functions use an empty search path and explicit grants. Internal execution is granted only to the protected service-role runtime; ordinary authenticated users cannot manufacture observations, confirmations, quotes, audit events, or notifications. `set_appointment_mutation_capabilities` is granted only to `pawport_scheduling_worker`. The database also rejects `reschedule_supported=true` while the documented contract is absent.

Owners must own the appointment's household. Provider actions require both an active business owner/admin/scheduling_manager role with location access **and** the existing explicit scheduling permission for the connection. Staff cannot mutate. Business roles do not create `provider_scheduling_permissions` or `provider_memberships`. Provider reads contain only limited appointment summaries for authorized locations; they expose no watches, preferences, health records, other household data, credentials, or mappings.

Eligible appointments must be `external`, `ezyvet`, `booking_origin=pawport_live`, linked to a successful booking, current, future and scheduled/confirmed. The original confirmed animal/contact mapping must still belong to the appointment's pet and household. The organization/location and connection must be active. Arbitrary sync imports, manual appointments and Phase 8A request appointments cannot enter this path. Their existing behavior is preserved.

## Capability and runtime gates

Cancellation defaults off. A trusted operator must approve it; credential/account changes clear approval and validation. Before an operation, the Edge runtime resolves the existing allowlisted opaque secret reference, validates the catalog, availability permission and exact calendar record, then records a fresh validation. Beginning a mutation requires both booking and mutation validation within five minutes, booking/availability/cancellation capability and active state.

The existing two sandbox environment gates, exact origin allowlist, confirmed-user JWT verification and database sandbox gate remain mandatory. Vendor traffic is fixed to ezyVet trial hosts. There is no production host option, production capability activation, credential installation, or Next.js service-role key in this phase. Provider settings display operator-controlled support; business users cannot toggle trusted capabilities.

## Cancellation state machine

1. The owner/provider opens connected options; safe capability output contains only appointment ID, `canCancel`, `canReschedule=false`, and pending state.
2. A separate confirmation asks Pawport to cancel with the provider. No optimistic local cancellation occurs.
3. The database locks the operation, reauthorizes the actor, snapshots canonical start/end/updated timestamp and external version, and records `initiated`.
4. A second exact vendor GET checks for changes in modification cursor, schedule, identity, type and resources. The database checks its canonical snapshot again and records dispatch.
5. One documented PATCH is issued. It is never automatically retried after a possible send.
6. Strict vendor proof is durably recorded as `vendor_confirmed`; local completion checks for newer sync data and updates the **same** appointment to cancelled/current.
7. The mutation becomes `completed`. Its immutable appointment/alias/external identity is preserved. Existing cancelled-appointment reminder, Today and Timeline behavior applies.

A partial unique index permits one unresolved mutation per appointment. Advisory locks and transactional writes prevent duplicate clicks from producing another operation. The daily mutation limit is ten per actor. Definite authorization/validation/rate-limit rejections fail without changing the appointment. Network ambiguity, unexpected responses and post-vendor persistence failures remain unresolved. The UI shows **Provider confirmation pending**, disables repeat changes, and offers a read-only status check.

Provider-initiated successful cancellation emits one existing-system notification of type `appointment_change`, tied to the mutation, household owner and pet. Integrity triggers validate the recipient, action URL and deterministic dedupe key. Own successful actions do not create redundant notifications. Existing notification types and their references remain intact; no provider notification platform is added.

## Reconciliation and conflicts

`reconcileUnknownLiveMutations` is a callable protected worker abstraction, not a public scheduler endpoint. The authenticated owner/provider can request a narrow status check for their authorized appointment through the existing Edge Function. Database leases use SKIP LOCKED, bounded batches, two-minute leases, backoff and at most ten attempts. Reconciliation performs **GET only**, never PATCH or booking.

A matching inactive vendor record with an adequate modification cursor can conclusively cancel the canonical appointment. An unchanged active record after a dispatched PATCH is **not** proof the request was never processed; it remains unknown. A conclusively pre-dispatch operation can resolve as unchanged. After the bounded attempts, an operator must investigate unresolved outcomes using vendor evidence; this phase does not invent a forced-success or retry button.

Canonical database changes after the snapshot block dispatch or local completion. Connection-first locking follows the importer order. A vendor sync cancellation queues the same recheck; the importer retains its existing authoritative identity/version logic. No synthetic vendor version is written into `external_appointment_state`.

**Residual vendor race:** the current contract does not document an atomic conditional PATCH/If-Match precondition. The final GET plus local snapshot check detects observed changes, but cannot make a remote read/PATCH pair atomic. A clinic change between those requests remains a sandbox pilot risk. Production readiness requires a reviewed vendor concurrency/reconciliation policy, including stale sync observations following a mutation; this implementation does not claim to solve that with invented headers or version units.

## Rescheduling and Smart Opening moves

The schema and adapter capability distinguish cancellation from rescheduling. `rescheduleAppointment`, reschedule-availability, reschedule-confirmation and opening-to-quote actions return `unsupported` before any vendor mutation or quote creation. The UI directs owners to the provider to change the time. Consequently there is no enabled “Book this opening” or “Move appointment” action, and no local reminder reset pretending a reschedule occurred.

Once an authoritative rescheduling contract is available, the intended path is watched appointment → immutable link → current binding → five-minute quote → explicit owner review → exact live availability reconfirmation → documented vendor update → same canonical appointment. A future completion transaction must reset the existing 24-hour/two-hour reminders and preserve the external identity. A Smart Opening must reuse that same path, not introduce a second booking/mutation implementation. The match alone is never authority, and no automatic move is permitted.

## Real availability watches and cancellation rechecks

`lib/openings/live-worker.ts` exposes `processLiveAvailabilityWatch` and `processLiveRechecks` with injected restricted RPC transport and the protected sandbox credential/adapter resolver. There is no browser invocation or recurring production polling. The worker derives service/binding from the existing live appointment link and uses the **existing** `matchAvailability` implementation, existing watch leases, match identity and notification dedupe.

The worker scans the bounded watch date range in seven-date requests; the adapter batches at most five resources per vendor call. It uses vendor site timezone for requests, adds a one-day boundary envelope and retains the watch's IANA timezone for weekday/time matching. Only actual normalized vendor slots enter the matcher. No resource ID becomes a browser field. Staff-specific watches cannot be satisfied by guessing that a resource is a staff member.

Complete snapshots update disappeared matches through the existing processor. More than 100 slots, a deadline, malformed data or any failed batch is treated as an incomplete check: existing matches are preserved rather than incorrectly marked unavailable. This conservative bound can defer busy calendars until a future paginated snapshot design.

Confirmed cancellation enqueues a connection/service/UTC-date-window record. The trigger also runs for actual sync transitions to cancelled, including tombstone normalization. Repeated cancelled-to-cancelled writes do not enqueue again. A later distinct cancellation in the same window resets the deduplicated request with a short delay so a previously completed check does not suppress new work. Leases/cursors process at most 25 relevant watches per page and bound retries. Queue consumption queries real availability; cancellation itself never creates an opening.

Unlinked/non-live watches retain their existing informational behavior. This worker does not infer bindings for them. Businesses can cause a recheck through cancellation without gaining access to its watchers.

## Scheduling, privacy and operational readiness

No production cron, worker deployment, remote migration or vendor call was performed to implement/test this phase. A future protected scheduler must provide the same sandbox-gated credential resolver and restricted RPC transport to the callable workers, bound concurrency, monitor unknown operations and exhausted leases, and use a separate reviewed production rollout. Tokens, service-role keys, animal/contact IDs and raw vendor payloads must never be logged. Notification and owner/provider DTOs omit those fields.

Tests use sanitized fake HTTP responses and an isolated local PGlite database running the full migration chain. They cover the exact cancellation contract, ambiguity/no retry, unsupported rescheduling, authorization, canonical identity, mutation dedupe, conflict snapshots, reconciliation, queue behavior, safe notifications, matcher reuse/disappearing slots and confirmation UI. Existing suites continue to cover request cancellation, mapping, medical/review privacy and production gates. PGlite does not prove independent multi-session PostgreSQL concurrency: real sandbox staging must exercise simultaneous cancel/withdraw/sync/reconciliation sessions before certification.

Known limitations:

- ezyVet sandbox only; production remains disabled.
- Rescheduling, reminder reset after reschedule and explicit Smart Opening moves remain disabled pending documented vendor semantics.
- Only Pawport-created live external appointments qualify.
- No unsupported-vendor operations, contact/animal creation, payments, fees, refunds or financial promises.
- No auto-booking, vendor polling cron or broad provider/customer notification system.
- Unknown dispatched mutations can require manual vendor investigation after bounded read-only reconciliation.
- Remote read/PATCH atomicity and full live vendor sync ordering require certification; no undocumented precondition is claimed.
- Large availability snapshots and more than the bounded queue pages require later worker scaling.

## Phase 9 readiness

The authoritative request/live-booking appointment model now has a cancellation operation ledger, reconciliation boundary, durable service association and event-driven availability rechecks. These support a future complete scheduling lifecycle without duplicating appointments or exposing medical data. **The reschedule/explicit-move leg is not complete** until ezyVet establishes its supported update contract and sandbox tests validate it. Broader insurance, preventive-care intelligence, partnerships and provider operations are outside this phase.

## Local validation

September 12, 2026: lint, TypeScript, production build and Deno checks passed. The full regression suite passed with **284 passed, 3 existing hosted-environment skips, 0 failures** (287 total). The 26 new Phase 8C tests passed. Browser checks exercised the actual confirmation component in a temporary local demo fixture at mobile and desktop widths, including keyboard activation, no horizontal overflow and the pending state with repeat mutation controls absent. No console errors were reported. The fixture was removed before the production build. These checks do not replace authenticated hosted integration testing or ezyVet sandbox certification.
