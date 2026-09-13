# ezyVet commercial readiness inventory — September 13, 2026

This is an internal engineering inventory and planning checklist, not a claim of partnership, certification, pilot participation or general availability. It was assembled by reading the current repository source after fetching main (`fa411ec`) and the existing [live-booking](LIVE_BOOKING_EZYVET.md) and [connected-operations](CONNECTED_APPOINTMENT_OPERATIONS.md) documentation. No new API semantics or vendor calls are introduced in Phase 10A.

## PetThread workflow and implemented capabilities

PetThread supports appointment requests requiring a human response as the fallback. Its specialized ezyVet sandbox foundation supports catalog, real availability, short-lived owner quotes, explicit confirmation, exact availability recheck, vendor booking and canonical external appointment/reminder creation. Confirmed pet/contact mappings are required; no ezyVet contacts or animals are created. Ambiguous booking POSTs remain unknown and are not blindly retried.

Connected cancellation supports only PetThread-created live external appointments, required authorization/mapping/capabilities and documented cancellation semantics. Local status changes only after vendor success or conclusive reconciliation. Unknown PATCH outcomes remain pending without automatic mutation retry. Canonical appointment identity and existing sync handling are preserved. Smart Opening notifications remain informational where direct moves are unsupported; nothing auto-books.

**Unsupported:** connected rescheduling and Smart Opening → direct reschedule. `supportsAppointmentReschedule` is false and `rescheduleAppointment` throws unsupported. The existing verified PATCH contract does not establish start/end/resource/type update inputs. No cancel-and-rebook workaround is implemented.

## Architecture and credential model

Entry point: `supabase/functions/scheduling-live-booking/index.ts`. Specialized adapter: `supabase/functions/_shared/live-booking/ezyvet.ts`. Contracts/parsers: `contract.ts`, `schemas.ts`, `appointment-schema.ts`. Orchestration: `pipeline.ts`, `connected-pipeline.ts`, `reconciliation-worker.ts` in the same directory.

Protected Edge execution validates bearer users, origin and narrow payloads, and calls restricted internal RPCs. Next.js has no service-role key. The existing resolver accepts only `EZYVET_CONNECTION_[A-Z0-9_]{1,64}` and parses partner_id, client_id, client_secret, grant_type, supplied scope and site_uid. Scope strings come from issued configuration; this phase does not invent a commercial scope bundle. OAuth tokens stay in server memory. Generic partner credentials do not replace or duplicate these ezyVet secrets.

## Existing sandbox controls

`credentials.ts::assertSandboxRuntime` requires `PAWPORT_SCHEDULING_ENV=sandbox` and `PAWPORT_EZYVET_SANDBOX_ENABLED=true`. The adapter's hosts are fixed to `https://api.trial.ezyvet.com` and booking `https://apiv2.trial.ezyvet.com`. Database runtime/capability, business, profile, service-binding, mapping, validation and owner consent gates remain required.

The Phase 10A migration does not update `live_booking_runtime_settings`, provider booking/cancellation capability flags, the false reschedule capability or these host/runtime gates. Generic production execution also remains unavailable. The new optional commercial bridge is only an internal association, not a new dispatch permission.

## Endpoint inventory from current source

All paths below are in `supabase/functions/_shared/live-booking/ezyvet.ts`:

| Method / endpoint                   | Purpose / code method                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| POST `/v1/oauth/access_token`       | `accessToken`: credentials → strictly parsed temporary OAuth token                            |
| GET `/v3/siteInformation`           | `getCatalog`: site identity and authoritative timezone                                        |
| GET `/v2/appointmenttype`           | `getCatalog` → `load("appointmenttype")`: active types, bounded pagination                    |
| GET `/v2/resource`                  | `getCatalog` → `load("resource")`: active calendar resources; unknown pagination fails closed |
| GET `/v4/calendar/availability`     | `listAvailability`: bounded dates/resources/duration, normalized real slots                   |
| POST `/ezycab/booking`              | `bookAppointment`: explicit booking after exact recheck; no ambiguous POST retry              |
| GET `/v2/appointment?uid=…`         | `getAppointment`: resolve canonical UID to documented numeric appointment ID                  |
| GET `/v2.1/calendar/appointments`   | `getAppointment`: `filter[id][in]` and pageSize=1, strict narrow reconciliation               |
| PATCH `/v2/appointment/{numericId}` | `cancelAppointment`: documented cancellation, not general rescheduling                        |

The PATCH content type is `application/merge-patch+json`; current code sends `{cancel:true,cancellation_reason_text:"Cancelled through PetThread"}` and requires `write-appointment`. Response verification requires the expected ID/UID and inactive state. Other successful-looking/malformed responses remain unknown. The prior connected-operations document records the vendor documentation review behind this contract; Phase 10A does not extend it.

Availability uses v4, never the deprecated legacy endpoint. Vendor request limits and parsing remain in the existing adapter/schema: at most five resources and seven dates per request, bounded duration and deliberate batching. Do not infer write fields from read response fields. Required read/booking commercial scopes must be confirmed with ezyVet for the issued account; successful OAuth alone is insufficient.

## Workflow confirmation and development/docs checklist

- [ ] Confirm commercial API approval and named ezyVet technical/support contacts.
- [ ] Obtain actual sandbox credentials and exact granted scope list securely.
- [ ] Confirm endpoint access, booking response identity and current cancellation semantics with ezyVet.
- [ ] Demonstrate site/timezone, types/resources and multi-resource availability batching.
- [ ] Demonstrate confirmed animal/contact mapping, no automatic identity creation.
- [ ] Demonstrate explicit owner choice, short-lived quote, slot recheck and slot-gone fallback.
- [ ] Demonstrate canonical appointment/reminders and later sync deduplication.
- [ ] Demonstrate definite errors versus ambiguous POST/PATCH, without duplicate mutation.
- [ ] Confirm unsupported rescheduling stays hidden and appointment requests remain available.
- [ ] Review privacy, audit, credential rotation, runtime disable and incident runbooks.

## Certification demo checklist

- [ ] Agree certification requirements and demo format with ezyVet; no requirement is assumed completed.
- [ ] Prepare sanitized sandbox owners/pets and mapped services, never production patient records.
- [ ] Complete availability → explicit booking → confirmation → canonical sync demonstration.
- [ ] Complete documented cancellation and read-only reconciliation demonstration.
- [ ] Show wrong owner, unmapped pet, stale quote, paused connection and unsupported capabilities failing closed.
- [ ] Show no medical records, insurance or costs in vendor payloads.
- [ ] Show timeouts/unknown outcomes do not produce false booking/cancellation success.
- [ ] Record outstanding vendor feedback and approval evidence externally through the authorized commercial process.

## Multi-location testing

Review each site_uid, site timezone, service/type/resource binding and claimed Place ID relationship independently. Confirm location-scoped business access and separate explicit scheduling permission. Test cross-location rejection, mapping isolation, DST boundaries, duplicate resource times and canonical identity across sync. A partner-level contract/capability does not grant every site access or owner consent.

## Pilot onboarding and five-site / six-week tracking

Five sites and six weeks are proposed planning targets, subject to ezyVet agreement. `partner_pilot_sites` records candidates, documented consent, credential readiness and actual pilot dates, with per-status counts. No sites are seeded, contacted, described as active or claimed to have consented.

- [ ] Identify five prospective consenting sites through an approved commercial process.
- [ ] Record each site's actual consent and named operational owner.
- [ ] Bind the correct commercial connection and existing scheduling location.
- [ ] Install credentials securely; validate scope and mappings per site.
- [ ] Review owner sharing design and applicable consents before any owner data flow.
- [ ] Complete sandbox acceptance and certification prerequisites.
- [ ] Agree six-week start/end dates, support coverage, monitoring and success criteria.
- [ ] Track actual active/completed/withdrawn outcomes without claiming an unstarted pilot.

## Support ownership and incidents

Record PetThread technical owner plus partner support/security/privacy contacts. Never store credentials or patient information in pilot notes. Establish on-call coverage, unknown-outcome escalation and responsibility for contacting the clinic to verify ambiguous state. No automatic emails or support messages are sent by Phase 10A.

Rollback/disable: pause the affected partner/connection/capability in the generic control plane and disable the existing scheduling sandbox runtime/capabilities through its trusted controls as applicable. The generic bridge is not yet in legacy dispatch, so disabling only the generic registry is insufficient to stop legacy scheduling. Revoke/rotate compromised credentials through protected configuration. Preserve canonical appointments and audit; do not blindly repeat a mutation, locally cancel a vendor appointment or delete evidence. Use documented read-only reconciliation and escalation when vendor state is uncertain.

## General availability / production activation checklist

- [ ] Commercial/API access and executed effective contract confirmed.
- [ ] Required scopes and credential ownership documented.
- [ ] Sandbox workflow confirmation complete.
- [ ] Certification approval actually received.
- [ ] Consenting pilot sites onboarded and agreed pilot completed.
- [ ] Monitoring, reconciliation, support and rollback ready.
- [ ] Owner/business data-sharing authorizations reviewed and recorded.
- [ ] Service mappings, confirmed pet/contact mapping and location permissions reviewed.
- [ ] A separately reviewed production adapter/runtime change is approved; trial-only hosts are not changed casually.
- [ ] Production credentials installed in protected runtime; no secrets in PostgreSQL/Next.js.
- [ ] Typed production capabilities approved; connection validated; technical approval recorded.
- [ ] Independent runtime enablement deliberately authorized after all existing scheduling gates pass.

None of these checkboxes is marked complete by this phase. Phase 10B is commercial sandbox, certification and pilot readiness—not automatic general availability.
