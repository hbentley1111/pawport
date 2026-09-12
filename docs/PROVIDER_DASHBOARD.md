# Provider Dashboard + Team Management — Phase 7C

## Purpose and trust boundaries

Phase 7A approves business representation; Phase 7B publishes business-provided profiles; Phase 7C gives that business a private operational workspace. The dashboard is a read model over organizations, memberships, locations, published profiles and safe connection health. It does not duplicate appointments, health records, profile state or Google business content.

Three identities can coexist on one account:

- Pet owner: personal household, care, records, timeline and notifications.
- Business member: `service_provider_memberships`, team administration and scoped business views.
- Veterinary verification member: existing `provider_memberships`, with its independent professional authorization.

Business roles never create veterinary membership, verification queue authority, health-document access, `provider_scheduling_permissions`, connection mutation permission or worker access. The business role named **scheduling_manager** is not an integration authorization grant. Profiles, reviews and Smart Openings retain their existing trust boundaries.

## Migration and tables

Apply `supabase/migrations/202609110013_provider_dashboard.sql` only after Phase 7B migration `202609110012_business_profiles.sql`. No migration was applied remotely during development.

Existing `service_provider_memberships` gains `location_scope = all | selected`, default **all**. Existing IDs, users, roles and active flags remain unchanged. A CHECK constraint requires owner/admin to use all locations.

| New table                               | Purpose                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `service_provider_membership_locations` | Composite membership/location grants for selected scopes.                                                    |
| `service_provider_invitations`          | Private normalized email, assigned role/scope, token hash, issuer, seven-day expiry and final-state history. |
| `service_provider_invitation_locations` | Selected location grants captured by an invitation.                                                          |
| `service_provider_audit_events`         | Append-only team activity; bounded allowlisted role/scope metadata.                                          |

No new notification, appointment, business profile or scheduling connection table is created. Indexes support the pending organization/email uniqueness rule, inviter/day limit, organization audit ordering and Google Place ID connection-summary lookup. Existing profile/location/membership indexes are reused.

## Roles and hierarchy

| Actor              | Invite                           | Change/remove                                 | Location access |
| ------------------ | -------------------------------- | --------------------------------------------- | --------------- |
| Owner              | Admin, staff, scheduling manager | Any active non-owner teammate, excluding self | Always all      |
| Admin              | Staff, scheduling manager        | Staff/scheduling manager, excluding self      | Always all      |
| Staff              | None                             | None                                          | All or selected |
| Scheduling manager | None                             | None                                          | All or selected |

There is no owner invitation, demotion, removal, ownership transfer or self-leave flow. Owners can demote admins; admins cannot modify other admins or owners. Promoting a scoped member to admin atomically changes scope to all and clears selected grants. Demoting an admin retains all scope until an authorized location-access change is made.

All role decisions are enforced in database helpers/RPCs. UI predicates merely hide unusable controls and never establish authority.

## Location scope

`service_provider_can_access_location(organization, location)` derives the current user from `auth.uid()`. It requires active membership, active organization, active location, matching organization identity, and either all scope or an explicit grant.

This predicate powers dashboard reads and **existing Phase 7B private profile-management reads**. Updating only the new dashboard would leave an old-route bypass; migration 013 also replaces the Phase 7B business index/editor query bodies and location authorization helper while preserving their public contracts. Public published profiles remain public irrespective of private membership scope.

Selected scopes require at least one valid location. Inputs are bounded to 100 distinct UUIDs; cross-organization and suspended locations are rejected. Composite keys prevent duplicates, immutable grant guards reject reassignment, and deferred constraint triggers require matching scope/grants at commit. Switching selected → all removes grants transactionally. Historical grants may remain on deactivated members or suspended locations, but the access predicate stops access immediately on subsequent requests. Organization-wide logo/profile fields remain shared organization information; unassigned location drafts are excluded.

## Invitation architecture

`create_service_provider_invitation`:

1. Authenticate and serialize the inviter's rate-limit check with a transaction advisory lock.
2. Lock the active organization and check the actor's current owner/admin role.
3. Validate requested role and location scope. No owner invitation is possible; admin actors cannot invite admins.
4. Normalize `lower(trim(email))`, validate syntax/254-character bound. No account-existence query is performed at creation.
5. Expire elapsed pending invitations for the organization, then enforce one pending invitation per normalized organization/email, 50 pending invites per organization and 20 new invitations per inviter per rolling 24 hours (across organizations).
6. Generate 32 cryptographically random bytes with pgcrypto, encode a 64-character hex token, and store only SHA-256(token).
7. Persist selected locations and append an invitation-created audit event in the same transaction.
8. Return the raw token once, with expiry. No later RPC can retrieve the token.

Team capacity for this foundation is 200 active memberships per organization; create/accept checks serialize against the same organization lock. Roster reads return up to 200 members, prioritizing active members before historical inactive rows. Larger teams and full history pagination can be added later without changing identities.

Invitations last seven days. Preview/accept/pending-list queries enforce expiry even if stored status has not yet been materialized as expired. The next invitation creation marks elapsed pending rows expired; no background expiration job is needed. Expired/revoked records remain stored.

No invitation email is sent. The creator sees a copy button and a manual-copy fallback immediately after creation. If the link is lost, revoke and create another invitation. The UI does not re-fetch or persist raw tokens in local/session storage.

## Acceptance and identity

`/provider/invitations/[token]` shows no invitation details when signed out. It asks the recipient to sign in and reopen the link; the raw token is not placed in a generic login redirect parameter.

`service_provider_invitation_preview(token)` returns only the business name, role, scope, selected location names and expiry for a pending, unexpired invite matching the signed-in user's **actual confirmed Supabase Auth email**. It reads `auth.users.email` and `email_confirmed_at`, not browser-supplied email or JWT email metadata. Wrong-email, unconfirmed, invalid, expired and revoked invitations reveal no details.

`accept_service_provider_invitation(token)` accepts only the token as business input. It derives user, email, organization, role and locations inside the database. It locks organization then invitation, rechecks expiry/email and the inviter's current authority, locks any existing membership, revalidates active locations, and atomically inserts/reactivates membership plus grants and acceptance audit.

An active membership is rejected with **You already belong to this business**; its role is never silently escalated or downgraded. An inactive non-owner membership may be reused with invitation role/scope, preserving membership ID. Reactivating a historically admin membership requires an invitation issued by a currently active owner. Historical owner memberships cannot be reactivated/downgraded through this flow. Repeated acceptance fails safely and never creates a second membership.

## Revocation, removal and races

Owner/admin may revoke pending invitations within their hierarchy (admins cannot revoke admin invitations). A revoked token cannot be accepted. Removing a member sets `active=false`; it does not delete the membership or affect that person's pet-owner account. Private business reads and profile-edit authorization reject removed members on the next request. Previously delivered browser data cannot be recalled.

An admin who loses team-administration rights, or any deactivated member, has their pending issued invitations revoked. These automatic revocations are audited. Acceptance also independently rechecks inviter authority, protecting against trusted-operator changes outside normal UI workflows.

Organization-first locking serializes invitation acceptance/revocation, membership role/access/removal changes, and existing profile changes. Invitation/member rows are then locked; selected locations receive share locks during validation to serialize against suspension. Constraints prevent duplicate membership, duplicate pending invitation and cross-organization grants.

Tests exercise both terminal race outcomes and duplicate acceptance requests. PGlite serializes queries on its connection; actual competing PostgreSQL sessions should additionally be exercised in isolated staging using the checklist below. The SQL organization/row locks provide the production transaction boundary.

## Dashboard and switching

Routes:

- `/provider/dashboard`: generalized business operational home.
- `/provider/businesses/[organizationId]/team`: owner/admin roster, invitation form, role/location changes, removal, pending invitations and audit.
- `/provider/invitations/[token]`: authenticated invitation preview/acceptance.

Account, My Claims, profile-management pages and the veterinary workspace link to the business dashboard. `/provider` remains the existing veterinary verification workspace. Profile editing continues to use Phase 7B routes; there is no duplicate editor.

The dashboard RPC returns up to 100 member organizations and 100 accessible active locations per organization. The client switches only among authorized data already returned; all subsequent page/RPC requests independently reauthorize. Suspended organizations show unavailable status without team/location actions. Suspended locations disappear from active operational choices. Scoped users cannot discover unassigned drafts through the old profile-management routes.

Location cards show name, authoritative profile status, public-profile link when published, Local Services link and scheduling health. Owner/admin get profile/team management actions. Staff and scheduling managers get read-only location/profile views; the UI never offers connection mutations based on business role.

## Scheduling and Smart Openings

Match existing `service_provider_locations.google_place_id` to existing `provider_connections.google_place_id` for read-only summary. If multiple connections match, prefer an active connection, then most recently updated, with ID tie-breaker. This is a display selection, not a new authoritative connection binding.

Only `connected`, controlled status/system identifier, `availabilitySupported`, last successful sync and error-present boolean are returned. No credential reference, vendor account/location ID, connection ID, raw error, payload, sync event, pet mapping, appointment, watch or notification data reaches the dashboard.

Availability requires active connection + stored availability capability; mock capability additionally respects the existing database demo setting. The server suppresses mock availability in production, and mock statuses are explicitly labeled Demo. No vendor calls, availability queries, polling, mutation or booking occur. Integration management remains in the separately authorized existing connection system; business membership creates no `provider_scheduling_permissions`.

## Team and audit privacy

`service_provider_team` is owner/admin only. It returns membership ID (needed for narrow actions), teammate email, role, active/scope state, selected location IDs, joined date and a derived is-self boolean. It does not return Auth user UUID, raw metadata, provider identities, factors, credentials, household data or claim evidence. Invitation emails are private management information.

`service_provider_audit_history` returns the latest 100 normalized events: safe actor/target email, event type, assigned role/scope, timestamp and event ID. It never returns raw metadata, token hash, issuer UUID, credentials or vendor data. Audit is append-only; direct browser writes are revoked. Supported events: invitation created/revoked/accepted, role changed, location access changed, member deactivated. Emails are resolved from current Auth/team records rather than copied into an additional identity store.

Public Phase 7B profiles are unchanged and never include the team roster, invitation emails, audit history or membership roles. Community review rules and reviewer privacy remain unchanged; team membership grants no review moderation or reviewer identification rights.

## Token transport and logging

Invitation pages are dynamic/private/no-store, noindex/nofollow, with neutral metadata and no-referrer policy. Proxy protection also sets `X-Robots-Tag: noindex, nofollow, noarchive`. Links to login/account do not propagate tokens. No application logging, analytics or telemetry is added to invitation pages/actions; errors are sanitized rather than dumping RPC arguments.

Raw tokens necessarily exist in the recipient URL and acceptance request. Before hosting, configure reverse-proxy/CDN/access-log and error-monitoring redaction for `/provider/invitations/*` and redact request bodies containing invitation tokens. Framework/hosting access logs are outside this repository's application logger; do not enable full-URL analytics, session replay or request-body capture for this route. Do not paste real invitation URLs into tickets or logs. This phase does not provision hosted logging or send emails.

## RLS and database API

All four new tables have RLS enabled. Direct privileges are revoked from PUBLIC, anon, authenticated and Supabase default service_role where present. Internal authorization/token/audit helpers are not callable by browser roles. Explicit authenticated grants exist only for safe dashboard/team/invitation/member/audit RPCs and the context-derived location predicate. No new public read API exists for teams.

RPCs: `my_service_provider_dashboard`, `service_provider_team`, `create_service_provider_invitation`, `service_provider_invitation_preview`, `accept_service_provider_invitation`, `revoke_service_provider_invitation`, `update_service_provider_member_role`, `set_service_provider_member_locations`, `deactivate_service_provider_member`, `service_provider_audit_history`.

Every function fixes search_path. Authenticated actions validate shape and reauthenticate; database ownership and hierarchy remain authoritative. Invitation acceptance accepts no browser email/user/org/role/location. Private profiles reuse central location access. Existing medical, review and scheduling policies are unchanged; migration tests compare policy definitions before/after.

## Local and staging verification

Run `npm run lint`, `npm run typecheck`, `npm run build`, then `npm test` (build before full tests lets the existing secret scanner inspect the finished client bundle). Tests use local PGlite with real SQL roles and migrations 001–013. No remote migrations or data changes are needed for automated tests.

Automated coverage includes pre-migration membership compatibility, all/selected access and old-route filtering, owner/admin hierarchy, hashed/random token generation, actual confirmed email matching, expiry/revocation/reuse, inactive reactivation, pending/rate limits, audit privacy, direct-grant denial, scheduling DTO safety, immutable identities, and medical/integration separation. Pure render tests cover switching, role-aware controls, empty/suspended states, source/capability wording and token transport protections.

Manual isolated staging acceptance:

1. Back up staging, review migration 013, and apply it only after 012. No new app environment variables, vendor keys or email integration are required. Confirm existing staff defaults to all locations.
2. Use approved test businesses with owner/admin/staff/scheduling-manager accounts and two locations. Check organization and location switching at 390px, tablet and desktop widths.
3. Invite each allowed role; verify admin cannot invite admin and owner invitation is impossible. Copy the link once. Confirm pending list cannot retrieve the raw token; inspect storage only through a trusted operator and verify hash-only storage.
4. Open the link signed out: no business details, no token in login redirect/referrer. Try wrong and unconfirmed email accounts, then the correct confirmed account.
5. Accept and verify role/scope, old profile-route isolation and no new veterinary/integration access. Repeat acceptance; attempt an invite for an active member; deactivate/reinvite an inactive member and verify the same membership row is reused.
6. Test selected → all → selected, cross-business/suspended location rejection, owner/admin protection and removal. Remove an admin with a pending invitation and verify that token is revoked and audited.
7. In two independent staging database sessions, race accept against revoke and role/access updates against removal. Verify one legal serial outcome, no duplicate membership/grants and consistent audit; race new grants against location suspension.
8. Check safe connection status for no connection, paused/error/active synthetic staging fixture and mock disabled in production. Confirm no account/location/credential IDs, pet/owner watches or raw payloads in browser responses.
9. Check team/audit denial as staff, unrelated and anon; public profile still shows only provider-owned public fields. Verify veterinary queue, health document privacy, connection mutation permissions and Community reviews remain independent.
10. Confirm sensitive-path logging redaction before hosted invitation use. No email should be sent. Recheck all owner flows including login/reset-password, pets, Today, records/shares, Care, Timeline, Openings and Notifications.

## Verification results

September 12, 2026: lint, typecheck and production build passed. Full regression: **205 tests total, 202 passed, 3 existing hosted-integration tests skipped, 0 failures**. The built-browser secret scan ran. New tests also compare pre/post migration membership identities and existing RLS policy definitions.

Browser fixtures using actual dashboard/team components passed at 390px, 768px and 1440px without horizontal overflow or unlabeled form controls. Organization switching to scoped staff showed only the assigned location and no management links. Invitation confirmation controls were accessible and browser errors were empty. The temporary fixture was removed before build. A temporary local production server confirmed invitation responses use `private, no-store`, `no-referrer`, `noindex, nofollow, noarchive`, a neutral title and no signed-out invitation details; that server was stopped afterward. No remote migration, email, vendor request or business-data mutation occurred.

## Limitations and future operations

Invitations are link-based with no email delivery. No ownership transfer or self-leave; no provider appointment inbox/request workflow, booking, messaging, customer list, billing, analytics, review replies/moderation, real vendor connection or automated veterinary credential verification. Scheduling management stays separate. No team role grants hidden integration authority.

Dashboard/location lists and roster/audit history are bounded MVP views, not full-history search; the roster prioritizes active members. Profile edits to published profiles retain Phase 7B immediate-publication behavior. Suspended-location invitations require revocation/reissue with valid access before acceptance. Existing public profiles remain publicly readable even by unassigned team members.

This foundation supports later provider operations, location-aware workflows and explicitly authorized appointment requests without changing business identities. Future invitation email can deliver the same one-time raw token during creation; it must not require storing/recovering plaintext. Future scheduling controls must check the independent integration permission model. Veterinary trust elevation must remain an explicit separate process.
