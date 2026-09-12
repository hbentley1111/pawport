# Provider Claiming Foundation — Phase 7A

Branch: `feature/provider-claiming`. Migration: `supabase/migrations/202609110011_provider_claiming.sql`, after migrations 001–010. This implementation does not merge, deploy, apply remote migrations, or contact a scheduling vendor.

## Purpose and the trust boundary

A business discovered through Google Places can request representation on Pawport. **Claimed on Pawport** means Pawport approved a claim that a user represents the business. It does not mean licensed veterinarian, professional credentials verified, medically vetted, or authorized to verify records.

| Identity                         | Purpose                                           | Authority                                             |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `service_provider_organizations` | General Pawport business identity                 | Business representation only                          |
| `service_provider_locations`     | Organization locations linked to Google Place IDs | Listing ownership, independent of scheduling          |
| `service_provider_memberships`   | Business-management roles                         | Owner/admin/staff/scheduling_manager                  |
| `veterinary_providers`           | Existing veterinary medical verification entity   | Existing separately provisioned verification workflow |
| `provider_memberships`           | Existing veterinary verification membership       | Existing narrowly submitted medical-record access     |

Approval writes **only** the new business tables. It never creates a veterinary provider, medical membership, scheduling permission, provider connection, pet mapping, notification, or review-management right. Even a Google listing categorized as a veterinarian gets no medical trust elevation. Business roles intentionally omit `verifier`.

A future professional/organizational verification process may explicitly link a business organization/location to a veterinary provider. That link must require an independent trust decision and must not be inferred from Google category, business email, or claim approval.

## Schema

- **Organizations:** UUID, claimant-entered/Pawport-owned name (1–160 trimmed characters), active/suspended status, created/updated timestamps.
- **Locations:** UUID, organization FK, bounded Google Place ID, active/suspended status, timestamps. Organization/Place ID identity cannot be reassigned.
- **Memberships:** UUID, organization FK, user FK, owner/admin/staff/scheduling_manager role, active flag, timestamps. Organization/user identity is immutable. A unique organization/user pair is stronger than one active membership: future reactivation should update the existing row rather than creating duplicates.
- **Claims:** UUID, Google Place ID, immutable authenticated requester, optional requested organization, organization-name snapshot, claimant role (1–100), business email (syntax checked, ≤254), optional note (≤1500), `manual_review` method, pending/approved/rejected/withdrawn status, private reviewer note (≤1500), reviewed/created/updated timestamps, and approved-location FK. State/reference CHECK constraints keep pending/withdrawn requests unreviewed and successful requests linked to a matching location.

A unique Place ID reserves the location even while suspended. This is intentionally stronger than one active location per Place ID: suspension must not allow a takeover. Claiming a second location creates another location row under the same organization. Ownership transfer, suspension recovery and disputes require a later explicit workflow; identities are not silently moved or hard-deleted.

Indexes support actual lookups: unique Place ID, organization-to-location lookup, active user memberships, unique pending user/place claim, owner/date/UUID pagination and the oldest-pending review queue.

## Google data and confirmation

Only `google_place_id` is retained as Google-derived identity. No Google name, address, phone, website, rating, reviews, hours, photos, categories or coordinates are copied into these tables. The new-organization name starts **blank** in the form. The claimant enters it independently; when attaching an existing organization the database uses that organization's existing Pawport-owned name, ignoring a browser-supplied rename.

The claim page uses the existing server-only Places transport with a new fixed minimal confirmation mask:

```text
id,displayName,formattedAddress,googleMapsUri,attributions
```

The current name/address, Google Maps link, official Google Maps logo and returned provider attributions appear in a separate live-confirmation panel. They are not form defaults or persisted claim fields. Fetches are `no-store`, redirects are rejected and the existing timeout/validated URL strategy remains intact. The dynamic claim page fetches once for confirmation; successful form submission performs another fresh confirmation before calling the database. No Google request occurs inside the database or reviewer RPC. Raw authenticated RPC submissions can pass format validation without an upstream Google lookup, so the human reviewer must independently confirm the listing and representation; a syntactically valid Place ID is not proof of a real business.

This follows the existing conservative persistence design and Google's [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies), checked September 12, 2026: Place IDs are exempt from caching restrictions, while other Places content and attribution requirements remain controlled by Google's terms. Pawport still needs appropriate publicly accessible Terms of Use and Privacy Policy before public launch; this document supplies no legal language.

No new environment variable, API, vendor SDK, OAuth app or service-account credential is required. Existing `GOOGLE_MAPS_API_KEY` remains server-only; Places API (New) and its existing Google Cloud billing/key restrictions apply. The confirmation mask avoids rating, review-count, phone and hours fields that the claim panel does not display. Existing search/detail masks and review logic are unchanged.

Missing configuration, quota errors, an unavailable business or database status errors block the claim form with a clear retry/configuration state. The application still builds/tests without a key. A missing claim status must never be rendered as an unclaimed business. No Google content is logged, persisted in local storage, or publicly cached.

## Claim lifecycle

1. A signed-in user opens `/provider/claim?placeId=...` from a Services listing. A pet/household is not required; authentication is.
2. Validate the Place ID, load safe ownership status and the caller's active owner/admin organizations, and fetch current Google confirmation.
3. Enter a new organization name, claimant role, business email and optional note, or select an existing organization. Email syntax is validated; **ownership of that email is not verified**. The copy says Pawport may use it during manual review.
4. `submit_service_provider_claim` derives `requested_by` from `auth.uid()`, rejects unknown input fields and applies length/type bounds, ownership checks and abuse limits.
5. A new pending request appears in `/provider/claims`. It confers no permissions.
6. Only an independent restricted reviewer may approve/reject. For a new organization, approval atomically creates organization, owner membership and location, then finalizes the claim. For an existing organization, it creates only the location and finalizes the claim after rechecking current owner/admin authority.
7. Pending claims may be withdrawn with explicit form confirmation. Editing is deliberately **withdraw + resubmit**. Approved, rejected and withdrawn claims cannot be edited or returned to pending.

Repeated withdrawal of an already withdrawn own request is harmless. Repeating the same review decision returns the prior result without creating another location or replacing reviewer notes. Changing a terminal decision is rejected. A competing claim remains pending after an approval conflict; the reviewer can reject it separately after assessing the conflict.

Submission limits: 10 requests per user in a rolling 30-day period, including withdrawn/rejected requests, and one pending request per user/place. Unknown client fields (including requester/status/reviewer metadata) are rejected. These limits are database-enforced, with an owner-scoped advisory lock to serialize concurrent submissions. The existing per-process Services limiter also bounds paid confirmation fetches; distributed enforcement remains a future high-volume improvement.

## Concurrency and integrity

Review locks the claim row, then takes a transaction-scoped advisory lock keyed by Google Place ID, then rechecks the location reservation. The unique Place ID constraint is a final backstop. Both submission and approval use the same Place ID lock namespace. Organization and membership rows are share-locked while checking active owner/admin permission, preventing approval from racing an in-flight permission or suspension change.

Two pending claimants can exist for the same unclaimed listing. If reviewer A's approval wins, reviewer B's approval cannot create a second location or an orphan organization/membership: any failure rolls back the transaction. A claimant's permissions are checked again at approval, so a revoked/admin-to-staff change after submission prevents attaching the location.

Identity triggers prevent changing claim requester, Place ID, requested organization or submitted content; membership organization/user; and location organization/Place ID. Final claims are immutable. The approval reference must point to the matching claimed Place ID and requested organization where supplied.

## Private data and DTOs

`my_service_provider_claims` returns only the caller's id, Google Place ID, organization name, status, claimant role, created/reviewed timestamps and a derived participation-active flag. It uses `(created_at DESC, id DESC)` cursor pagination, default 25 and maximum 50. It does not return business email, claim note, reviewer note or requester UUID.

`my_service_provider_organizations` returns at most 100 active organizations the caller owns/administers, as id/name only. Staff, scheduling managers, inactive memberships and suspended organizations are omitted. There is no membership write API.

`service_provider_claim_statuses` is the only public read projection. It accepts at most 20 validated Place IDs and returns Google Place ID, claimed/claimable booleans, and active organization id/name where applicable. No pending request, membership, claimant identity or processing note is exposed. Suspended organizations/locations have no active badge or organization identity in this projection and remain unavailable for a new claim. The claimant's approved history remains visible without implying active participation.

The **restricted** review queue is a separate internal projection containing claim-processing fields, including private email/note/requester and reviewer note. It is never imported into a browser route or public listing DTO. React renders entered text as text; no HTML rendering is used.

## RLS and reviewer architecture

All four new tables enable RLS and revoke direct table access from PUBLIC, anon and authenticated. No permissive policies are added. New RPCs use an empty search path, explicitly qualified relations, and explicit EXECUTE grants. Supabase-style default `service_role` grants are also removed from these new tables/functions when that role exists, so a broad service key does not accidentally become the reviewer path. Existing tables, roles, RLS, storage policies and medical/review grants are unchanged.

- Authenticated: submit/withdraw own claims, read own claims/organizations.
- Anon and authenticated: safe listing claim statuses only.
- `pawport_claim_reviewer`: NOLOGIN/NOINHERIT; execute `service_provider_claim_review_queue` and `review_service_provider_claim` only. It receives no raw table grants.
- Database owners retain normal administrative powers. Do not use those powers as a browser API.

There is **no public reviewer route, general admin portal, new review credential or automated reviewer**. A future backoffice must authenticate an authorized operator and use a server-only, narrowly provisioned connection that can assume the reviewer role. Do not grant that role to `anon`, `authenticated`, business members or ordinary provider verifiers. Do not expose database credentials in `NEXT_PUBLIC_*`. Normal business claimants cannot approve themselves. If a reviewer call carries the claimant's authenticated UID, the RPC rejects it as requiring independent review; a trusted backoffice must also enforce independent human review operationally.

### Manual staging review procedure

Use a separate staging project with migration 011 applied. A trusted operator may use its SQL editor; a future backoffice should use a dedicated login role permitted to assume only `pawport_claim_reviewer`.

Read the bounded pending queue under the restricted role:

```sql
begin;
set local role pawport_claim_reviewer;
select public.service_provider_claim_review_queue(null, 25);
commit;
```

A specific request can be inspected with `service_provider_claim_review_queue(claim_uuid, 1)`. Treat results as private operational information; never paste them into public logs, reviews or listing responses. Independently confirm the current listing and the claimant's representation using Pawport's approved review process. An email address or Google category alone is not proof. Review representation only; do not record this as veterinary credential verification. Keep reviewer notes short and avoid unnecessary personal data or credentials.

After reviewing, replace the sample UUID with the actual reviewed claim and execute the appropriate **explicit** decision:

```sql
begin;
set local role pawport_claim_reviewer;
select public.review_service_provider_claim(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'approved', -- or 'rejected'
  'Private representation-review decision note'
);
commit;
```

No claims are approved simply by running the migration. Review notes remain private and are not rejection feedback. The reviewer queue defaults to oldest pending requests, bounded to 50; processing those lets the next requests advance. A full searchable backoffice, reviewer assignment/audit identity, service-level commitments, automated email verification and safe claimant feedback are future work.

## UX and compatibility

Services detail adds “Own or manage this business?” with Claim this listing, or “Claimed on Pawport” with an explicit medical-trust clarification. Existing Google information and Pawport community reviews remain separate and unchanged. Status failures show unavailable rather than implying unclaimed ownership.

`/provider/claim` supplies the live Google confirmation and claimant form. `/provider/claims` shows the user's requests, status-specific copy, pending withdrawal with confirmation and cursor pagination. Approved requests say profile management is coming next; no fake editor is provided. Rejections use neutral copy and the existing Help destination, never private reviewer notes. Account gains My business claims. Shared framing preserves owner navigation where the user has a household and uses the existing guest/business brand otherwise.

The existing `/provider` remains the veterinary verification workspace. Login, account/password recovery, household onboarding, Today, Care, Timeline, medical records, share passes and owner navigation are not replaced. Signed-out claim links require login through the existing authentication flow; after login a user may need to reopen the listing because this phase does not redesign authentication return destinations.

Business claiming cannot identify “Pawport Member” reviewers, edit/delete/suppress community reviews, or add business-response rights. Scheduling remains in its existing separate permission model. A future location can be associated with `provider_connections` through a matching `google_place_id`, but that match alone must not grant scheduling administration, activate a connection, enable `availability_supported` or expose household watches. No Smart Openings behavior changes.

## Tests and acceptance

Automated database tests apply migrations 001–011 to isolated PGlite PostgreSQL with actual roles, RLS and RPC execution. They cover private tables, default service-role grant removal, anonymous/cross-user denial, immutable identities, spoofed inputs, manual review, competing approvals, idempotency, exact owner creation, multi-location attachment, permission rechecks, suspension/reservation, rate limits, cursor pagination, private/public DTO separation and unchanged medical/scheduling authority. An existing medical verifier still successfully processes an explicitly submitted request and its Phase 6C notification reaches the correct pet owner.

Transport/render tests mock Google responses and verify the minimal fixed field mask, no-store requests, missing-key/error states, attribution, blank claimant name, existing organization selector, state copy, escaped text, medical-trust clarification, server-only actions and explicit withdrawal confirmation. Existing regression tests remain intact.

Run Node 22+:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Before a separately authorized production rollout:

1. Back up and apply 011 after 001–010 to **staging only**. Verify RLS, grants, function execution roles and unchanged medical/storage policies.
2. Use two unrelated claimants and a separately authorized reviewer. Confirm a valid business live through the configured staging Google key. Enter an independently chosen organization name; inspect tables to confirm Google display fields were not stored.
3. Submit requests from both claimants for the same listing. Approve one, attempt the other; only one location/organization ownership succeeds. Repeat the first review and verify no duplicate rows. Also exercise two real concurrent database transactions: isolated PGlite queues queries in one engine and cannot prove hosted multi-session lock timing.
4. Test requester spoofing, raw table/membership writes, direct authenticated reviewer calls, private email/note access and foreign-organization attachment. All must fail. Inspect public status and owner DTOs.
5. Approve a second location for the first owner/admin. Revoke membership or suspend the organization before another approval and verify denial. A suspended existing listing must not be claimable by someone else.
6. Withdraw with confirmation, reject a separate request, hit the rolling rate limit and paginate history. Check unavailable Google/key/quota/claim-status states and an already claimed listing.
7. Confirm no new veterinary provider/member or scheduling record/capability exists. Attempt verification and foreign medical-document reads as the claimant; deny. Existing authorized verifiers and all owner workflows must still work.
8. At 390px, tablet and desktop, verify labels, required validation, organization selector, blank new-business input, focus, withdrawal confirmation, no horizontal overflow and readable trust copy. Do not submit browser fixture data to a real project.
9. Only after acceptance, separately authorize production migration and code rollout. Provision reviewer operations deliberately; do not enable broad public review APIs.

## Limitations and next phases

Manual representation review, disputed ownership, ownership transfer, reviewer identity auditing, safe rejection feedback and claim-data retention policy need operational design. No dispute workflow, public profile editor, paid plan, ad placement, analytics, messages, invitations, credential checks, automated email/SMS verification or vendor integration is built. There is no automatic notification/email delivery for claim decisions. Claimants inspect My claims. Historical submitted fields are immutable; corrections require withdraw/resubmit and count against the limit.

**Phase 7B:** Add independently provider-entered descriptions, logos, services, contacts, hours, location details and booking preferences to organizations/locations, never to claim records. Preserve Google/Pawport data separation and the meaning of the claimed badge.

**Phase 7C:** Build invitations, role management, location switching and business settings on memberships. Explicitly bridge to scheduling permissions only after a separate authorization design; a `scheduling_manager` business role does not currently grant Phase 5B scheduling access. Preserve the independent veterinary-verification trust boundary throughout.

## Verification result

Lint, TypeScript and the production build passed on Node 22. The full regression suite passed with 172 tests: 169 passed, three existing hosted integration tests skipped, zero failures. The final focused database run also passed after tightening reviewer permission-denial assertions and checking that an existing matching scheduling connection retained its original status/capability.

Browser-only fixture checks at 390px, 768px and 1440px found no horizontal overflow or framework error overlay. The new organization field was blank despite a visible Google name; selecting an existing organization used its saved name in a read-only field. Withdrawal required an unchecked confirmation checkbox with keyboard focus and a label. Mobile text inputs use 16px text, and helper/trust copy has explicit readable contrast. The real signed-out claim route redirected to login, which retained Forgot password and no owner navigation. The fixture was removed before the build; no claim was submitted to a remote database. Hosted authenticated acceptance and real multi-session concurrency remain staging checks.
