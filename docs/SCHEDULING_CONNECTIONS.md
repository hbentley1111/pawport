# Provider scheduling connections — Phase 5B

Branch: `feature/provider-scheduling-connections`. This phase contains infrastructure, owner consent, status UI and a local mock. There are no live vendor requests, credentials, OAuth apps, webhooks exposed to the internet, booking flows or remote migration/deployment steps executed by the implementation.

## Architecture

Provider/location connection → trusted external customer/pet binding proposal → explicit household-owner confirmation → verified adapter event → normalized worker import → existing Phase 5A appointments → private household calendar.

`lib/care/scheduling-adapter.ts` is the vendor-neutral contract. `lib/scheduling/registry.ts` and `worker.ts` are server-only entry points. The schema, mock and injected pipeline are independently testable core modules; the client import graph must never reach the registry, worker or mock. The normal Next.js app has no privileged scheduling database client. Future workers supply a separately authenticated, narrowly scoped RPC transport to `workerStore`.

A connection identifies a provider/location, not a household. It may serve multiple households, but each household receives only its own proposed/confirmed mapping and appointments. A scheduling manager does not get a household directory, private pet records or sync logs. The provider verification workspace continues to use its original authorization path.

## Migration and tables

Apply **`supabase/migrations/202609110006_scheduling_connections.sql`** after 001–005, in an explicitly authorized environment. The migration creates six RLS-enabled tables with **no browser SELECT or mutation grants**:

| Table                             | Purpose and key rules                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_connections`            | UUID; operator-entered display label (never prefilled from Google); nullable veterinary provider FK and Google Place ID (at least one required); connection type; system; account/location identifiers; optional credential reference; pending/active/paused/error/revoked status; connected-by/time; last attempt/success/error code/time; timestamps. |
| `provider_scheduling_permissions` | Explicit per-connection, per-user grant: `provider_admin` or `scheduling_manager`, active flag, timestamp. No grants are inferred from provider membership.                                                                                                                                                                                             |
| `external_pet_mappings`           | Connection, household, pet, external pet/customer references; pending/confirmed/rejected/disconnected; owner decision identity/time. Unique external pet ID per connection, including rejected/disconnected mappings. Identity cannot be reassigned.                                                                                                    |
| `provider_sync_events`            | Connection/event identity, type, object identity, receipt/processing timestamps, processed/ignored/blocked state, bounded error code, SHA-256 payload fingerprint. No payload, pet/customer name, notes or raw error text.                                                                                                                              |
| `external_appointment_state`      | Private per-connection canonical external appointment identity, mapping, existing appointment FK, last version, tombstone flag. Also holds tombstones received before creation.                                                                                                                                                                         |
| `external_appointment_aliases`    | Connection-scoped vendor replacement IDs → immutable canonical identity. This is a cursor/alias store, not another appointments table.                                                                                                                                                                                                                  |

`appointments` gains only nullable `sync_state`: current/paused/disconnected/attention. No existing appointment, review, medical or Storage policy/function is replaced. The Phase 5A unique external identity and identity trigger remain unchanged. Pre-existing appointments and external rows are not rewritten or backfilled; a real adapter must reconcile any historical external rows before adoption.

Connection types: veterinary, grooming, boarding, daycare, training, walking, sitting, other. System identifiers: mock, ezyvet, daysmart, gingr, moego; only mock has an implementation. No Google business name, address, rating, review, hours, coordinates, phone or website is persisted. A Google Place ID is the only Google content identifier used. No Places integration code or attribution changes are required.

Operational records use restrictive FKs to preserve consent/identity history and prevent accidental remapping. They are not automatically purged on household/pet removal. There is no pet deletion flow; future account erasure needs a deliberate dependency-aware retention/anonymization procedure.

## RLS, database mutations and scheduling authorization

All six new tables enable RLS and deny direct access to anon/authenticated. The safe SECURITY DEFINER functions have empty search paths, explicit grants and `auth.uid()` checks:

- `my_scheduling_connections`: allowlisted status DTOs for an explicitly authorized manager or owner with a mapping. It omits credential reference, account/location/vendor object identifiers, provider IDs and other households.
- `my_external_pet_mappings`: only the signed-in household owner's mapping ID, pet ID/name, connection reference and consent state. Neither managers nor verifiers can enumerate customer/pet mappings.
- `decide_external_pet_mapping`: owner can confirm/reject a pending proposal or disconnect a confirmed mapping. A rejection/disconnection is terminal in this phase.
- `set_scheduling_connection_status`: explicit scheduling grant required; active/error → paused, healthy paused → active, non-revoked → revoked. A paused error cannot bypass validation by resuming.

Opaque connection and mapping UUIDs are used as private action references, never displayed as business content. Guessing them does not grant access. Credentials and sync event IDs never appear in owner appointment UI.

A new **NOLOGIN, NOINHERIT `pawport_scheduling_worker`** role has only execute access to:

- `propose_external_pet_mapping`: derives household from pet, records a pending proposal.
- `validate_scheduling_connection`: pending/error → active **after the trusted worker has validated the adapter**, clears error state. It cannot revive revoked connections.
- `import_scheduling_event`: atomic import with event/cursor/mapping enforcement.
- `record_scheduling_failure`: bounded health codes only.
- `record_scheduling_run`: attempted/completed poll timestamps, including empty polls.

It has no table privileges and is not granted to anon, authenticated, authenticator or a runtime login by this migration. No browser-facing import server action exists. The normal app cannot invoke imports. A future isolated worker login/transport must be provisioned separately with TLS and only this role; do not grant it to Supabase's browser-authenticated role or use a service-role key in a Next.js client.

Connection provisioning and scheduling grant assignment are trusted operator tasks, not self-service in this phase. An operator checks provider/location ownership before inserting a pending connection and assigning a scheduling grant. `connected_by` records the authorizing identity when provisioned. A verifier's existing membership grants no scheduling capability; both scheduling roles currently share lifecycle management rights, leaving grant delegation to an operator.

## Secrets

`credential_ref` is an optional opaque reference, never an API key/token. Mock connections cannot have a credential reference. There is no credential resolver, credential input form or actual secret stored in this phase.

For the first adapter, use an encrypted server-only secret store such as Supabase Vault with a dedicated worker-only resolver, or a managed secrets service. Keep OAuth token bundles and refresh tokens outside public business tables. Resolve by the already-authorized connection, verify the reference belongs to that connection, use least-privilege access, redact logs, rotate/revoke tokens, and implement atomic refresh locking. Do not let a request choose a secret path. Do not grant public access to decrypted Vault views. Design/token scope validation belongs to the first real adapter review.

No new production environment variables are required. `PAWPORT_ENABLE_MOCK_SCHEDULING=true` is optional **only in local development/test**. It is not a `NEXT_PUBLIC_*` variable. Mock methods recheck that NODE_ENV is development/test and VERCEL_ENV is not production. A production build/runtime rejects mock operation even if the flag is accidentally present.

## Explicit external pet matching

A future trusted worker must independently bind the authenticated external customer to the correct PetThread household through provider authorization plus owner authentication/consent. It may then propose a pet mapping. Do not feed arbitrary client-supplied connection, customer or pet IDs into the worker RPC. Worker credentials are trusted operational authority, not a substitute for verifying this binding.

Names, breed, phone and email are never matching keys in this implementation. The owner sees a pending proposal for their own pet and must verify the record with the provider before confirming. The UI intentionally does not expose raw vendor customer IDs. The real adapter must supply an adequate owner verification flow before enabling proposals for live data. A scheduling manager cannot confirm for the household owner.

A confirmed mapping is required at import time. The transaction locks the mapping while writing so consent revocation and sync serialize safely. Database triggers require pet/household consistency and owner attribution on confirmed mappings. One external pet cannot be mapped to a different PetThread pet by editing the mapping; rejected/disconnected mappings reserve the identifier until an explicitly audited future remapping workflow is designed.

## Sync and normalization lifecycle

1. Resolve connection from trusted worker configuration, not a payload field. Validate adapter/system/capability and connection authorization.
2. For webhooks, verify the original bytes first. For polling, read from the authenticated adapter. Normalize to the strict appointment event allowlist; it has **no household ID, pet UUID, provider name, Google content, notes or credential fields**.
3. Import under the worker role. Lock the connection and require active status; paused/revoked/error connections reject imports.
4. Record `(connection_id, external_event_id)` plus fingerprint. Repeated identical delivery returns duplicate. Reusing an ID with different content is rejected. Blocked events can be retried with the exact original event after consent or reconciliation.
5. Find the confirmed mapping within that connection. Unmatched events record mapping_required without exposing an appointment or retaining a payload.
6. Check per-object version. Lower/equal versions are ignored. A real adapter must provide a reliable monotonic vendor revision (within JavaScript safe integer range), or implement a reconciliation strategy using authoritative fetches; **never use arrival order as a substitute**.
7. Insert/update the existing appointment using mapped household, mapped pet, household owner, source=external, system and immutable canonical external identity. Updating must never move households/pets. Appointment constraints remain in force.
8. Tombstones cancel existing appointments without deleting them. A tombstone before creation records a cursor without inventing an owner-visible appointment. Older creates cannot resurrect it. A newer authoritative upsert may restore it.
9. For verified replacement IDs, resolve the predecessor alias. Unknown/conflicting predecessor IDs are blocked for reconciliation; no guess or second appointment is created. The original Phase 5A identity stays immutable.

`syncAppointments` bounds a poll to at most ten pages of 100 records and a one-year window; repeated cursors reject. Event failures return only bounded error state. Imports update attempt/success times; polling also records run start/completion, including empty polls. A completed pull may contain blocked consent proposals, which remain in the private event ledger for reconciliation. `record_scheduling_failure` marks attention/error; reconnect requires a newly validated worker call, not an owner button pretending OAuth exists.

No scheduled worker, queue, retry runner or network client is configured. A future production worker must add run IDs, transactional queue/outbox processing, retry/backoff/dead-letter policy, vendor-specific rate limits and monitoring. Do not acknowledge webhooks until durable acceptance. Failed/unmatched payloads cannot be reconstructed from the ledger; retry using an authenticated vendor fetch or a securely retained queue message. No full vendor payload is retained by default. If needed, use a private encrypted queue/store with a documented short TTL, access audit, deletion policy and minimal fields—never raw payloads in ordinary application logs.

## Webhook foundation

There is **no public webhook route**. `ingestWebhook` requires an adapter whose system matches the trusted connection and explicitly supports webhooks. It calls verifyWebhook before normalize/import. Unverified traffic cannot update connection health. The mock uses connection-bound HMAC-SHA256, timing-safe comparison, a five-minute timestamp window, a 32 KiB body limit and a process-local random signing key. These are test mechanics, not invented production vendor secrets. Only envelopes issued by that mock instance can be normalized; duplicate deliveries are handled by the database event identity.

A real endpoint must implement the vendor's actual signature algorithm over raw bytes, key rotation, timestamp and replay checks, body limits, allowlisted vendor routing, trusted connection lookup, rate limiting, verified event IDs and durable ingestion. Do not reuse the mock signature format for real vendors. Do not trust a `connection_id` from JSON to select credentials or a household.

## Adapter contract and capabilities

The registry recognizes system identifiers but throws for unimplemented vendors. No vendor SDK is installed. Capability flags are explicit: appointment read/create, cancellation, availability, webhooks, pet lookup. Optional methods correspond to capabilities; callers check both.

Contract groups:

- Connection validation and metadata.
- External pet listing (worker-private).
- Appointment list/get/normalize; bounded cursors and absolute timestamp normalization.
- Availability with service/staff/resource identifiers and time window.
- Optional booking/cancellation with idempotency keys; **no real write-back caller exists**.
- Webhook verification and normalization.

The mock exposes fictional pet/appointment data, isolated appointment copies, rescheduling, idempotent cancellation, availability, signed-event/duplicate simulation. Appointment creation is deliberately unsupported and its capability is false. The registry and methods reject production. Demo data is memory-only, not a real connected provider or a persisted booking.

External service mapping is deferred until a vendor's catalog semantics are known. The adapter must map approved external service IDs to controlled PetThread appointment types; unmapped services should require explicit mapping or use an approved `other` fallback with a safe title. A future `external_service_mappings` table would use connection + service ID, user/vendor-owned label, PetThread type and active flag. Service/staff/resource identifiers are available on availability queries/slots now. Do not persist Google-derived labels as vendor metadata.

## Connection and appointment UX

`/connections` is reachable from Account, Care and the provider workspace. It uses the existing conditional owner frame, so provider-only users keep their separate workspace. It shows connected/needs attention/not connected/paused/disconnected, system, sync dates and safe error state. Explicit managers can pause, resume a healthy connection, and confirm disconnect. Owners can confirm/reject/disconnect only their own mapping. No live Connect/Reconnect button is offered until validation/OAuth is implemented; the empty state explains this.

`/connections/demo` is authenticated and local-development-only, enabled by the explicit mock flag. It validates an in-memory mock and shows fictional pet/appointment counts. It performs no DB writes. The full persisted demo pipeline is exercised by the local PostgreSQL test described below; the preview is not a fake live connection flow.

External appointment cards show **Synced from provider**; details say **Managed by your provider** and remain read-only. Browser-local time display is preserved. Manual appointments still use their original create/edit/cancel functions. No connection UUID, vendor object ID or event ID is printed as source information. No vendor-derived private notes are imported or exported.

Disconnect never deletes appointments. Revoking the provider connection stops all sync and marks saved appointments disconnected. Owner disconnection stops only that pet mapping. A manager cannot resume owner consent by resuming the provider connection. Paused/error/disconnected stale states are visible. Restoring a revoked connection/remapping is deliberately deferred to a new authorization review.

## Local testing and staging acceptance

Use Node 22+. No vendor API key or remote database is needed for tests:

```sh
npm run lint
npm run typecheck
npm test
npm run build
# Focused isolated PostgreSQL end-to-end mock pipeline:
npx tsx --test tests/scheduling-database.test.ts
```

The test fixture creates Auth/Storage stubs and runs migrations 001–006 in PGlite, provisions fictional providers/owners, explicitly grants scheduling permission, proposes and confirms mappings, verifies signatures, imports through the dedicated worker role, updates/cancels, replays duplicates, rejects older events and disconnects. It never contacts Supabase or a vendor. Existing hosted tests still require explicit test credentials.

For the optional authenticated local preview, set `PAWPORT_ENABLE_MOCK_SCHEDULING=true` in a local development environment, start `npm run dev -- --port 3001`, sign in and open `/connections/demo`. Do not enable the flag in production. For actual status/mapping actions use an isolated local or authorized staging database with migration 006 and operator-provisioned **fictional** connections/mapping proposals; no production fixture seeding.

Acceptance checks before any later authorized release:

- [ ] Apply 006 after 005 in isolated staging; verify existing pets, records, share passes, reviews and manual appointments are unchanged.
- [ ] Verify connection DTO privacy for A/B/anonymous and a verifier without scheduling grants. Verify only an explicit connection manager can pause/revoke.
- [ ] Pending mapping imports remain invisible. Only the household owner can confirm; no automatic name-based matching.
- [ ] Import/update/cancel/tombstone/duplicate/out-of-order/replacement paths retain one correct pet appointment. Cross-connection and changed-pet attempts fail.
- [ ] Disconnect preserves history and stops imports. Owner disconnection remains disconnected when a manager resumes sync.
- [ ] Error codes remain bounded and no credential reference, raw payload, private identifier or stack trace appears in rendered content.
- [ ] Check status cards at 390px, tablet and desktop; keyboard actions, disclosure confirmation and mobile bottom-nav clearance.
- [ ] Production build plus mock flag still disables mock; demo route returns 404. Signed-out connection page redirects to login.
- [ ] Retest provider verification, manual appointment editing/ICS, Google services/reviews, multi-pet navigation and password recovery.

Migration/deployment order for a future authorized release: backup and inspect current migrations → apply 006 after 005 → release application → validate owner/provider smoke tests. No existing table is dropped. The app expects sync_state after 006; deploy the migration before this code. No merge, deployment, vendor connection or remote migration is authorized by this handoff.

## Future claimed businesses and Smart Openings

Future claiming: Google Place ID → verified business claim → provider/location identity validation → explicitly assigned scheduling admin → credential authorization → confirmed owner/pet mappings → appointment sync → later availability/Smart Openings. A Google listing alone never proves business ownership or scheduling permission. The nullable veterinary provider link allows non-veterinary locations without manufacturing veterinary verification records.

No availability_watches table or recurring availability checks are added. Phase 5C can reference this connection identity and capability flags, pet consent, external service and optional staff/resource IDs, earliest/latest date, preferred days/time window, active state and last check. Select the first real vendor before finalizing watch schema, notification delivery, availability semantics or booking consent. Google Places does not provide provider appointment availability.

## First real adapter readiness checklist

Before implementation, obtain and verify:

- [ ] Current vendor API documentation/version and commercial/partner approval, including permitted use and provider onboarding requirements.
- [ ] Authentication type, scopes, tenant/location binding, OAuth redirect/consent, token refresh/rotation/revocation and secret storage access model.
- [ ] Sandbox availability, fictional test clinic/location/customer/pet data and test credential lifecycle.
- [ ] Stable pet/customer IDs, verified owner-to-customer binding and explicit pet confirmation process; reassignment/merge/deletion behavior.
- [ ] Appointment list/detail endpoints, pagination, incremental sync cursors, stable IDs, monotonic versions and authoritative reconciliation for out-of-order delivery.
- [ ] Service/staff/resource catalog and mapping rules, location identifiers and timezone/DST semantics.
- [ ] Availability endpoints, supported filters, slot validity and whether availability is actionable or advisory.
- [ ] Webhook support, exact raw-body signature verification, rotation, timestamp/replay rules, event IDs, retry/ack requirements and replacement-ID semantics.
- [ ] Rate limits, quotas, retry headers, backoff policy, outage handling, idempotency and bounded reconciliation jobs.
- [ ] Provider authorization requirements, scheduling-admin capability proof and location isolation.
- [ ] Data retention terms, permitted fields, customer consent, erasure/export obligations and encrypted payload TTL if retention is required.
- [ ] Cancellation/tombstone behavior, whether cancelled records can return, disconnect semantics and history preservation.
- [ ] Explicit capability truth table; unsupported booking/cancellation/availability must remain unavailable.
- [ ] Acceptance tests for real sandbox sync, connection isolation, mapping consent, revoked permissions, credential secrecy, event replays, temporal ordering, cancellation and provider outages before production enablement.
