# Partner Activation & Integration Operations — Phase 10A

## Purpose and baseline

This phase adds the operational control plane for future real, contracted integrations. It does not activate an integration or establish a partnership. Development began from freshly fetched main `fa411ec` (September 13, 2026), including `202609110021_quote_status_function.sql`, rather than the previously reported Phase 9D commit.

Migration: `202609110022_partner_activation_operations.sql`. Existing partner organizations/connections are extended, not duplicated. No partner, connection, operator user or approved capability is seeded. The only settings row has both runtime switches **false**. No remote migration, deployment or production cron is part of this work.

## Trust and contract model

Partner organization means an internal company record; connection means a scoped relationship record. Neither establishes endorsement, credentials, medical authority, consent or executable integration access. Capability approval is necessary but insufficient. A data grant authorizes one category/purpose/direction/scope, not every operation. Health labels describe operations, not clinical trust.

Partner operational status remains separate from `contract_status`: none, evaluation, negotiating, executed, suspended or terminated. Contract dates, legal/reference information and optional operational/security/privacy contacts are internal and bounded. Production requires executed, currently effective/nonexpired contract information plus active partner status. No contract or certification is inferred from a business claim or ezyVet configuration.

## Typed capabilities

`partner_capabilities` is unique by partner/key/environment and supports requested, approved, paused and revoked states, optional expiry and approval audit information. Initial keys:

- scheduling.catalog.read
- scheduling.availability.read
- scheduling.appointment.read
- scheduling.appointment.book
- scheduling.appointment.cancel
- partner.health.readiness
- webhook.receive

Pharmacy, laboratory, insurance and payment capabilities are not accepted by the database or executable registry. Existing connection JSON capabilities remain empty and confer no authority. Application operator admins can approve/revoke through authorized RPCs; ordinary business/owner sessions cannot. Production approval requires an executed contract.

## Sandbox, production and connection state

Environment is stored on each connection and immutable after creation. Both sandbox and production connections are created disabled/pending. The browser cannot select an execution environment in a validation or worker request; operator admins may deliberately create a disabled production record for preparation.

Activation is auditable: created → credentials registered → validation → production requested → production approved → runtime enabled. Approval and enablement are different operations/events. An admin can perform both; this is not an enforced two-person/four-eyes control. Production approval itself also requires the deployment runtime switch, so it remains unavailable while the global kill switch is off.

Enablement requires active connection state (set atomically by the activation operation), eligible partner/contract, an unexpired approved environment capability, opaque reference, worker-confirmed credential configuration, successful validation within 24 hours after configuration, applicable runtime switch and production approval where relevant. Registering/changing a reference clears validation/approval and disables runtime. Revoked connections cannot be re-enabled through the console.

`partner_runtime_settings` contains sandbox/production switches. They are not editable through browser RPCs; a separately reviewed trusted database/bootstrap operation controls them. Both default false. The Edge runtime additionally requires its own sandbox setting for execution; the code rejects generic production execution unconditionally in this phase. No registered commercial adapter exists. Enabling a database flag alone never makes vendor execution possible.

Kill switches: pause partner, pause connection, revoke/pause capability, or turn off the trusted runtime setting. The centralized guard rechecks current state on every authorization. Revocation preserves owner records, appointments and historical events. It does not undo an already dispatched vendor request; future adapters must handle that boundary explicitly.

## Credentials and validation

`credential_ref` is an opaque `PARTNER_...` identifier, not secret material. Browser DTOs show reference present / credential configured booleans and never the reference value. Registration accepts only the reference and disables runtime. Users cannot assert successful configuration/validation.

`supabase/functions/_shared/partners/runtime.ts` defines a worker-only `PartnerCredentialResolver`. The environment resolver permits only `PARTNER_[A-Z0-9_]{1,100}` and reads exactly `PAWPORT_PARTNER_<REFERENCE>_CREDENTIALS`. For example a reference PARTNER_EXAMPLE addresses PAWPORT_PARTNER_PARTNER_EXAMPLE_CREDENTIALS. No real value is provided. Strict bounded JSON accepts typed api_key or oauth_client material; unexpected fields and arbitrary environment names fail. This is a future generic interface, not a duplicate ezyVet resolver. Existing ezyVet continues using its own `EZYVET_CONNECTION_...` convention unchanged.

Protected Edge Function `partner-operations` accepts only `{action:"validate", connectionId}`. It validates the bearer JWT through Supabase Auth, authorizes the actual user through operator memberships in a narrow internal RPC, enforces configured exact origins, JSON content type and a streamed 2 KiB body bound. It derives stored environment/reference/capabilities and records only safe validation results. Its service-role credential exists only in protected Edge configuration, never Next.js or the browser. No generic operator/vendor action executor exists.

Validation checks adapter presence, reference resolution, contract/environment and capability compatibility. No adapter is registered in 10A, including ezyVet in this generic layer. Therefore validation returns unsupported and cannot falsely claim a working integration. Future adapters may use only documented harmless endpoints. No fake endpoint or real vendor request is made.

## Explicit sharing grants and runtime authorization

`partner_data_grants` allows only pet_identity, owner_contact and appointment_data; purposes scheduling or integration_setup; directions outbound/inbound/bidirectional. Health records, vaccinations, prescriptions, lab results, insurance, preventive profiles and financial data cannot be granted. No share-all flag exists.

Household connections require the actual household owner. Operator status does not override owner consent. Business-scope grants require an operator admin and match the stored organization/location exactly. Business consent does not authorize a different household's data. Owner UI `/account/connections/[connectionId]` operates only on a pre-existing owner-scoped connection; it cannot create connections or forge the grantor. Owners select category, purpose, direction and optional expiration (up to one year); leaving authorization unchecked revokes that selection. Replacements revoke the old row, retaining history.

`partner_connection_authorized` is worker-only. It checks current partner/contract, connection, stored environment, runtime switches, credentials/validation, exact capability, expiry, exact subject scope, active business/location and every requested category grant. Appointment operations cannot omit appointment_data; booking also requires pet_identity and owner_contact. Empty categories are allowed only for non-owner-data operations such as readiness/catalog. Callers must supply required feature data categories from trusted code, never arbitrary browser choices.

The typed execution guard adds the registered adapter and server runtime gate. No vendor operation is implemented behind it in 10A. Future features must reauthorize immediately before dispatch and still apply owner/pet mappings, service binding, quote, availability, scheduling permissions and all existing feature-specific checks. Share Pass is never integration authorization.

## Event journal, idempotency and retries

`partner_integration_events` stores only bounded metadata: connection, typed event, direction, external/idempotency IDs, correlation, status, attempts, lease, safe status/error and timestamps. No body/header/vendor JSON column exists. Feature-specific durable payloads must use future normalized tables.

Uniqueness covers connection/direction/external event ID and connection/idempotency key. Repeated matching enqueue returns the same ID; conflicting identity is rejected. Enqueue serializes on the connection and caps 100 events/minute/connection. Workers claim 1–100 events with SKIP LOCKED and two-minute leases. A matching unexpired lease is necessary for completion/failure; repeat completion fails safely.

Definite failures retry with exponential backoff from 60 seconds, capped at one hour, at most ten attempts, then dead_letter. Unknown results are quarantined and never automatically retried. Expired book/cancel processing leases become unknown because dispatch might have succeeded. Expired read leases can be reclaimed; exhaustion becomes dead_letter. A future feature-specific, conclusive read-only reconciliation workflow is required to resolve unknowns; no generic force-retry button or vendor mutation is provided.

The metadata worker role is `pawport_partner_worker` (non-login). Internal RPCs are also available to the protected service-role Edge context. Ordinary authenticated/anon users cannot enqueue, lease, finish, fail, validate or execute internal guards. Claiming metadata is not authorization to transmit data: future workers must invoke the centralized feature guard before a vendor call. No polling worker or scheduler is activated.

## Webhook and adapter foundation

`PartnerAdapter` has typed validation/health methods, not execute(action,payload). `PartnerWebhookAdapter` defines verification, event identity/type and normalization. Both production registries are empty. Test adapters are injected only in isolated tests; there is no runtime registration endpoint.

`POST /api/partners/[partnerKey]/webhook` returns unavailable before reading or storing the body. This deliberate disabled route cannot authenticate a nonexistent partner. A future implementation must bind a known connection, registered partner-specific signature verifier, body/content-type limits, replay/idempotency protection, rate limiting, normalized event storage and current runtime authorization. No arbitrary forwarding, request-selected API key or fake production verifier exists.

## Operator authorization, console and audit

`partner_operator_memberships` maps real Auth users to operator/admin with an active flag. No email comparison, hidden link or URL parameter authorizes access. No public/browser direct writes or self-service escalation exists. Trusted existing `pawport_partner_operator` may provision through `bootstrap_partner_operator`; no users are seeded. Establish and review this membership through the deployment operator's trusted database path before using the console. Operators can inspect, validate, manage pilots and disable; admins manage contracts, capabilities, credentials, scopes and enablement.

Routes: `/operator/partners`, `/operator/partners/[partnerId]`, `/operator/partners/[partnerId]/connections/[connectionId]`. They show internal registry/contracts, connection scope/environment, capabilities, sharing, health, last successful event, dead-letter/unknown counts, recent metadata, activation history and audit. Lists are bounded to recent 100 entries. Credentials are configuration states only. Forms are labeled, mobile card-based and keyboard-operable. Private dynamic pages use existing private/no-store middleware and noindex metadata. No customer marketing or public partner badge is added.

`partner_connection_activation_events` and `partner_operator_audit_events` are append-only. Audit metadata allows only capability, environment, status transition and reason, with a byte bound. Do not enter secrets, owner information or medical data in operational notes/reasons. No credential references/material or raw event payloads are audited. Grant history is retained through revocation, not deletion.

## Safe logging and retention

`safePartnerLog` constructs an allowlisted record of partner key, connection/correlation IDs, typed capability, method, safe endpoint identifier, HTTP status, duration and controlled error code. Authorization, cookies, API keys, client/access/refresh secrets, raw URLs, bodies and arbitrary errors are discarded. No request payload logger is installed.

Recommended retention for future operational policy: successful metadata 90 days; error/dead-letter metadata 180 days. No destructive cleanup, production cron or scheduled retries are enabled. Unknown outcome evidence needs a separately reviewed reconciliation/retention policy before deletion.

## Pilot model and ezyVet bridge

`partner_pilot_sites` tracks candidate/contacted/consented/credentials_pending/ready/active/completed/withdrawn/failed, consent/start/end/completion dates, non-secret site reference and bounded internal notes. Connection, organization and location must match. Consented or later stages require a consent timestamp. No patient/owner data fields or credentials exist. Five sites and six weeks are planning targets, not claimed achievements. No clinics are contacted and no email is sent.

`partner_provider_connection_links` is optional, operator-admin-managed and unique on each side. An ezyvet partner link must match an existing ezyvet provider connection through the same claimed organization/location Google Place ID. It does not alter provider_connections, credentials, capabilities, production switches or medical permissions. The generic activation layer is not wired into legacy dispatch in 10A; a later reviewed adapter bridge can add it as another necessary gate.

See [EZYVET_COMMERCIAL_READINESS.md](EZYVET_COMMERCIAL_READINESS.md) for the inventory read from current source and certification/pilot checklists.

## Known limitations and Phase 10B

No real new credentials, active partner seeds, production execution, generic webhook verifier, pharmacy/lab/carrier/payment connectors, prescription/lab/insurance sharing, automatic approval, marketplace, public badge, scheduled retry worker, production cron, commercial certification/pilot claim or connected ezyVet rescheduling. Generic registry validation deliberately cannot succeed until a real reviewed adapter is registered. Operator bootstrap and global runtime switches require trusted deployment work. No operator user is provisioned by this migration. No email or notifications are sent. UI history is bounded; full operator pagination/export and unknown-event reconciliation are future work.

Phase 10B can register the actual commercial relationship and sandbox connection, install issued credentials securely, validate granted scopes, run documented workflows, complete certification, onboard five consenting sites and track a six-week pilot. Production activation remains a separate reviewed step after those prerequisites. Existing ezyVet production locks are unchanged; a generic partner approval never bypasses them.

## Validation performed

Local validation on September 13, 2026: lint, typecheck and production build passed. The complete suite reports **366 tests: 363 passed, three existing hosted-integration skips, zero failures**. Fifteen new cases include nested database scenarios covering operator isolation, production prerequisites, grant expiry/revocation, scope immutability, metadata idempotency, lease competition/expiry, ten-attempt dead letters, unknown mutation quarantine, pilots, append-only audit, strict private credential resolution, disabled adapters/webhooks and safe logging/UI output.

Both `partner-operations/index.ts` and the unchanged scheduling Edge Function passed `deno check`. Next.js excludes the Deno-only entry point from its compiler, matching the existing scheduling pattern; shared runtime code remains TypeScript checked. In-memory PGlite applies all migrations locally. Its queued concurrent calls verify serial state outcomes and constraints, but do not substitute for multi-session hosted PostgreSQL load/contention testing.

The actual operator status/sharing components were browser-checked in a temporary local fixture at 390 px: no overflow or browser errors, visible labels and an unchecked consent default. The fixture was removed before build. Authenticated persistence was exercised through local database tests; no remote operator bootstrap, consent, pilot or activation was performed. Existing ezyVet code, runtime hosts and capability gates are unchanged.
