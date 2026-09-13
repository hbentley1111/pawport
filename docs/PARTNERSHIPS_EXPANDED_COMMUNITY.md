# Partnerships & Expanded Community — Phase 9D

## Product purpose and trust architecture

Pawport connects claimed-business service knowledge to owner organization: request a quote, receive a manually entered price, explicitly save it to cost planning, and book/request an appointment separately. Offers and business review responses enrich the existing community. The partner registry is an empty internal foundation, not evidence of any commercial relationship.

| Concept          | Meaning                                                            | Does not establish                                                                 |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Claimed business | Approved ability to represent the business                         | Veterinary credentials, endorsement, service quality or health-record verification |
| Provider quote   | Price information entered by an authorized business representative | Guaranteed final price, invoice, medical advice or insurance coverage              |
| Business offer   | Information published by the business                              | Pawport recommendation, best price or guaranteed availability                      |
| Review response  | Response from the matching claimed business                        | Medical verification or access to reviewer identity                                |
| Partner record   | Internal relationship/configuration record                         | An active contract, public badge or executable integration capability              |

## Migration and models

`supabase/migrations/202609110020_partnerships_expanded_community.sql` is additive after Phase 9C. It is not applied remotely as part of development.

### Quote requests

`service_quote_requests` snapshots the owner-selected pet, household, owner, business, location, service title and optional note. Identity and submitted note are immutable. Initial intake requires an active, explicitly quote-enabled Pawport service at an active business/location with a published profile. `accepts_quote_requests` defaults to false on existing services. The initial implementation requires a service rather than supporting arbitrary service-less requests.

Statuses are requested, quoted, declined, withdrawn and expired. Requests initially expire after seven days. A sent quote extends workflow validity to its explicitly entered validity date, or thirty days if no date is entered. Reads present overdue requests as expired; new submissions lazily expire old open requests. A past quote date says “Quote validity date has passed,” without asserting whether the business would honor it.

Owners submit only for their own household pets. The note is explicitly shared and warns against sensitive medical information. No email is required or collected by this workflow. The business sees pet name/species, requested service, submitted note, dates, status and quote history. Household/user identifiers, health records, journal, care plans, preventive profile, insurance and financial history are absent from the provider DTO.

### Quote responses and versions

`service_quotes` has one row per request and points to its current revision. `service_quote_versions` is append-only, with revision 1–25 and unique quote/revision identity. Exact quotes require one amount; ranges require minimum and maximum with minimum <= maximum; contact-for-price permits no amount. USD integer cents use the existing technical bound of 9,000,000,000,000 cents. Dates and notes are bounded. Providers cannot silently overwrite historical price revisions.

The persistent disclaimer reads: “This quote was entered by the business and may not include every service, tax, medication, diagnostic test or change in care. Confirm final pricing with the provider.” Quotes are provider-entered estimates, never guaranteed prices or verified amounts.

Active business members can read assigned-location requests. Only owner/admin can configure intake, send/revise/decline/withdraw quotes. Staff and scheduling managers are read-only. Veterinary verification membership and scheduling-integration permission grant no quote authority.

### Explicit quote-to-planning conversion

`save_quote_to_planning` requires owner authorization and an available sent quote. The UI requires explicit confirmation. It creates one `pet_planned_costs` row with `source=provider_quote`, `quote_id` and a stable `quote_revision` foreign key. Exact amounts are copied only after confirmation. Range/contact quotes have null planned amounts; both range endpoints remain visible through the saved quote revision, with no midpoint.

Normal owner planning writes cannot select provider_quote or rewrite a quote-backed plan. Separate quote planning controls allow organizational status changes. An explicit update action advances the reference and exact amount to the latest revision. A new provider revision does not change an existing plan; the DTO/UI says the provider updated the quote. One quote yields at most one plan; repeated conversion returns the existing plan. The existing explicit actual-expense conversion still requires owner confirmation of the actual amount.

Quotes create no expenses, appointments or claims. Existing booking and appointment-request links remain independent. Offers are never automatically applied as discounts. Deductibles, reimbursement percentages and insurance entitlement are not consulted.

## Offers and publication

`service_provider_offers` supports promotion, new_client, service_package and informational entries, with title, description, optional value text, terms and dates. Value text is displayed verbatim as escaped text, never parsed into a savings calculation. States are draft, published, paused, expired and archived.

Owner/admin can manage organization-wide or matching-location offers. Publication reads require an active organization/location, published profile, published offer and matching explicit date window. Suspended businesses cannot mutate offers. No more than 100 non-archived offers may exist per organization, including reactivation checks; management returns the latest 100 entries. Historical rows remain stored.

Public DTOs contain offer text/dates, business name, optional location and “Offer from claimed business.” They contain no author/member identifiers or credentials. There is no redemption, checkout, inventory or payment process.

## Reviews, responses and reporting

`service_review_responses` has one response per review, with published/withdrawn/moderated states. Owner/admin must represent the active claimed location whose Google Place ID matches that review. Edits and withdrawal append business audit events. The response is escaped plain text, limited to 1,500 characters. Providers are warned not to include customer names, contacts, medical details or private information. Audit records identify the action; this initial phase does not retain a separate historical copy of each response body.

The existing public review reader is wrapped to append an explicitly constructed response DTO. Review text, stars, ordering and community score remain unchanged. Reviewer identity remains **Pawport Member**. Responder auth IDs and emails are absent. Withdrawn/moderated responses, hidden/deleted reviews and suspended businesses do not expose public responses.

`service_review_response_reports` stores authenticated private reports for harassment, privacy, spam, misleading or other. One report per user/response and ten reports/user/day bound abuse. The trusted `pawport_partner_operator` can read a recent 100-report queue and moderate a response through narrow RPCs. Reports do not expose reporter identities to businesses. A business cannot restore a moderated response. There is no AI moderation or broad provider review-moderation authority. No operator UI is included.

## Partner foundation and credentials

`partner_organizations` contains a stable key, display name, controlled type and candidate/sandbox/active/paused/terminated status. `partner_connections` contains an internal relationship to a partner and optional organization/location or household. Location and organization must match. Connection identity cannot be reassigned through the operator RPC. An active connection requires an active partner record.

Only the non-login `pawport_partner_operator` role receives registry mutation RPC grants. Ordinary authenticated users, including business owners, cannot create or activate partnerships. No rows are seeded. No public partner badge is shown. Operators must establish the actual contractual relationship before using active status; a database row does not prove a contract.

Credential references accept only a dedicated `PARTNER_` name and contain no credential material. They are never returned to browsers. No resolver, actual secret, service-role key in Next.js, partner API client or vendor request is added. Initial capabilities must be the empty object, and cannot act as authorization. A future contracted connector must define typed capabilities and its own explicit execution and sharing permissions.

## UX and integrations

- `/quotes` lists owner requests with cursor pagination and accepts contextual location/service requests. `/pets/[petId]/quotes` and its request detail show current quote and immutable revisions, withdrawal, planning confirmation and independent appointment actions.
- `/provider/businesses/[organizationId]/quotes` and detail provide a scoped inbox and owner/admin quote actions.
- `/provider/businesses/[organizationId]/community` manages service quote opt-in, offers and responses. Other active members receive read-only views. Reviews shown here are the most recent public page (20); older-response management pagination is a known limitation.
- Provider dashboard shows safe quote, offer and unanswered-review counts, respecting accessible locations, with contextual links. Organization-wide offers are visible to organization members.
- Published provider profiles show quote intake, offers and existing public community reviews/responses. Local Services adds the same Pawport-owned section alongside the Google listing. Discovery/search sorting, Google attribution, review ranking and medical guidance are unchanged. No additional Google business content is persisted.
- Account and Costs link to owner quotes. Quote-backed plans visibly retain provider provenance and their original revision.

No new primary navigation tab or social feed is added. Forms have visible labels, keyboard-native controls, pending states and error/status announcements. Quote ranges have an accessible “Provider quote: $650 to $900” label. Trust does not rely on color. Mobile cards separate quote source, amount, dates and actions.

## Notifications and auditability

Existing `notifications` gains `provider_quote_update` and a quote request reference. Quote revisions and provider declines notify the request owner. Integrity checks bind recipient, pet, request, dedupe prefix and exact owner detail URL; existing notification reference constraints remain intact. Dedupe keys identify request/revision or decline. No offer marketing notifications, email, SMS or provider notification system are added.

Existing `service_provider_audit_events` gains sent/revised/declined/withdrawn quote, published/paused/archived offer, and published/withdrawn response events. Metadata contains no quote prices, owner notes, reviewer identity, document contents or secrets. Immutable quote versions provide owner-visible price history.

## RLS, authorization and privacy

Every new table enables RLS and revokes direct public/anon/authenticated access. Narrow SECURITY DEFINER RPCs use an empty search path and explicit grants. Public readers return constructed safe DTOs. Internal helpers and operator functions are not browser-executable. Owner writes derive household/owner from existing ownership helpers. Provider writes use the centralized membership/location predicate and owner/admin gate.

Foreign pets, organizations, locations, quotes and planning references are rejected. Identity triggers and foreign keys prevent reassignment. Suspended locations/organizations disappear publicly and reject business edits. Team membership never grants medical or integration authority.

Share Pass, health documents, vaccination provenance, verification queues, preventive guidance, insurance, unrelated cost planning, Timeline, Today, reviews and scheduling retain their existing boundaries. New business DTOs do not read owner medical/financial data. No data is sent to ezyVet or any partner. General guidance never changes because of a quote or offer.

## Rate limits and concurrency

Owner advisory locks serialize submission limits: 20 requests/day, ten open requests, plus a partial unique index on owner/pet/location/service. Quote request row locks serialize send, revise, decline, withdraw and planning conversion. Quote revisions are unique and capped at 25. A unique plan quote reference and owner/request/quote locks prevent duplicate planning conversion. Organization locks serialize offer bounds/publication. Review row locks and a unique response key prevent duplicate responses. Report creation uses an owner advisory lock and rate bound.

Local PGlite tests exercise queued competing calls and database constraints. PGlite serializes execution; this is not a substitute for multi-connection hosted PostgreSQL contention/load testing. No remote migration or production scheduler is activated.

## Known limitations and future readiness

Quotes are manually entered and never guaranteed. No payments/deposits, negotiation/chat, automatic discounts, redemption, sponsored ranking, helpful votes, offer saves, public user profiles, social feed or direct messaging. No partner APIs, pharmacy ordering, laboratory integration, insurer integration, medical-record sharing, provider access to owner financial history, AI pricing or AI moderation. Intake initially requires a service. There is no unsent quote-draft editor, although draft exists internally during atomic quote creation. Saved quote plans retain their original planning year/category; changing price references is explicit. Quote date handling is calendar-date workflow information, not contractual interpretation.

Phase 10 can build contracted connectors, payments, pharmacy, labs and carrier workflows on these stable identifiers, immutable quote versions and explicit trust boundaries. None of those capabilities is implemented or implied here. Any future quote-to-booking/payment flow must retain explicit owner consent and distinguish a quote, planning amount, final invoice and actual expense.

## Development validation

Local validation on September 12, 2026: lint, TypeScript and production build passed. The regression suite reports 351 tests: 348 passed, three existing hosted-integration tests skipped, zero failures. Fifteen new test cases (including nested database scenarios) cover request opt-in, ownership/scope, price validation, immutable revisions, planning consent/source integrity, withdrawal/expiration, offers, reviewer privacy/reporting, partner grants, rate bounds, queued competing calls and UI/privacy boundaries.

A temporary local fixture using the actual quote/planning/response components was inspected at 390 px: no horizontal overflow or browser errors; the confirmation checkbox blocked submission when unchecked. The fixture was removed before build. Authenticated persistence was exercised in the local database tests, not through a remotely migrated browser session. No hosted migration, deployment, vendor request or real partner activation was performed.
