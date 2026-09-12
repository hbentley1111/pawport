# Pawport Today + Unified Notification Center (Phase 6C)

Pawport should remember what your pet needs so you don't have to. This release surfaces existing information that needs attention, without inventing tasks, clinical recommendations, streaks, scores, or reasons to return.

| Area          | Question                     | Authority                                       |
| ------------- | ---------------------------- | ----------------------------------------------- |
| Timeline      | What happened?               | Existing source records, normalized by Phase 6B |
| Care          | What routines am I tracking? | Owner-entered plans and occurrences             |
| Today         | What needs my attention now? | A private, bounded read model                   |
| Notifications | What has Pawport told me?    | Existing notification message history           |

## Migration and schema

Apply `supabase/migrations/202609110010_pawport_today.sql` **after migrations 001–009**, first in a separate staging database. This work does not apply any remote migration or deploy anything.

There are **no new tables**. In particular, there is no `today_items` table, second notification table, or copied timeline.

The existing `notifications` table gains nullable UUID columns `appointment_reminder_id`, `verification_request_id`, and `subject_pet_id`. Type, action-path, channel, and reference CHECK constraints are extended for `appointment_reminder` and `verification_update`, while preserving `availability_match` and `care_due`. Old rows need no backfill.

The new references are deliberately **logical immutable references**, validated against authoritative rows by an insertion trigger, rather than cascading foreign keys. The existing appointment editor deletes deselected reminder rows; verification records can disappear through existing source lifecycle operations. Those operations must not be blocked, and message history must survive. Source-retirement triggers dismiss obsolete messages; the immutable pet reference supports safe display after source removal. Owners cannot write these fields. Do not disable these triggers in operational workflows.

Indexes serve concrete queries: recipient/date/UUID pagination for visible in-app messages; recipient unread count; appointment-reminder and verification reference lookups for retirement; unsent in-app appointment reminders by appointment. Existing pet, vaccination, care, and timeline indexes are reused. No medical, provider, storage, or review policy is changed.

## Today read model and contract

`lib/today/` centralizes the contract, data access and priority merge. `my_pawport_today(zone)` joins only the caller's household and pets. It returns explicit JSON fields instead of raw rows. `my_today_openings(supportedSystems)` provides a bounded opening subset. Server code derives implemented capability support from the existing adapter registry, including its production mock guard. The browser cannot configure that list through `/api/today`.

`PawportTodayItem` includes stable `id`, `petId`, `petName`, `kind`, `category`, `urgency`, `title`, nullable `subtitle`/`dueAt`, `dateOnly`, `actionUrl`, `sourceType`, `trustState`, and a typed safe metadata allowlist. Allowed categories are care, appointment, opening, health and notification; urgency is overdue, today, soon or info. IDs are source-derived (for example `care:{occurrenceId}` and `vaccination-expiration:{vaccinationId}`). Safe metadata contains only action references, display timezone, snooze/demo flags, user-entered provider label, and checked/record dates. It excludes household/user UUIDs, external appointment/slot/customer IDs, provider UUIDs, storage paths, credentials, and private verification notes.

The three independent core/opening/count reads run in parallel. Result bounds are 10 attention, 10 coming-up, and 5 recent events. Counts can exceed displayed cards; existing Care, Appointments, Openings and Records destinations provide the full source views. An unavailable query produces an honest retry state, never “All caught up.”

### Source handling and priority

1. Active pending care that is overdue.
2. Active pending care due today.
3. Actionable earlier openings.
4. Today's scheduled, confirmed, requested or waitlisted appointments.
5. Unread successful verification messages whose request remains verified.
6. Explicit health-record expiration dates (expired or within 30 calendar days).

Future care and appointments through the next seven calendar days go into Coming up. They do not also appear in attention. Date and stable ID break ties within priority. The weekly summary counts care routines and appointments, without manufacturing urgency for routine items.

Care uses `snoozed_until ?? scheduled_for` and existing active/pending status. Completed, skipped, cancelled, paused and archived items are excluded. Completion and snooze call the existing Phase 6A actions/RPCs. Labels retain “Owner-entered care routine.” Snooze changes the occurrence's effective due time, not its underlying cadence.

Appointments use existing status and absolute time. Cancelled/completed outcomes stay in Timeline. A currently ongoing appointment remains visible through its explicit end; absent an end, a one-hour display grace is used. Past appointments outside that window are omitted. Manual appointments say “Owner-entered appointment”; external ones say “Synced from provider” and remain provider-managed.

Openings require a still-valid watch/connection, a supported adapter, available/notified match status, a future start and a sighting within the last 24 hours. Dismissed, unavailable, expired and stale results are omitted. This freshness ceiling is not a guarantee. Copy remains “Earlier opening found,” “Availability can change quickly,” and “Check availability.” Actions lead to the existing opening flow, never auto-book. Mock results are labeled Demo and excluded by server capability checks in production. No Google request or vendor query runs merely to render Today.

Vaccinations use **only existing `due_on`**. No interval, booster schedule, dosage, or medical need is inferred. Copy says “vaccination record expires/expired,” with provenance from `owner_vaccination_trust`: owner entered, document supported, or vet verified. An owner care routine is never promoted to verified medical data.

Recent activity calls the existing `my_pet_timeline` normalization for up to five events per owned pet, merges the small sets by occurrence time/stable ID and returns five. Care snapshots, vaccination trust, secure photo references and existing timeline source semantics are reused. There is no permanent household timeline or second source interpretation.

## Time zones and freshness

The client resolves its browser IANA timezone and supplies it to the authenticated Today endpoint. Both application validation and PostgreSQL timezone validation apply. The page waits for this response instead of initially classifying private care under a guessed UTC day.

Overall appointment/timed-event day boundaries and seven-day windows use that local calendar, not UTC dates or repeated 24-hour increments. Date-only care retains its plan's own calendar timezone, so a routine does not become overdue solely because its implicit storage time passed. Timed care is overdue only after the effective instant. Existing care recurrence/DST calculation is unchanged. Date-only health-record dates render in the requested owner zone without shifting their written date.

Today and count endpoints are authenticated, force-dynamic, private/no-store. Client requests are cancelled on cleanup; old responses cannot replace newer data. Home refreshes on load, window focus, and successful care/notification actions. The bell refreshes on navigation, focus and message actions. A continuously open unfocused page is not a live subscription; refocus/reload to refresh. No private response is publicly cached.

## Notification Center

`/notifications` offers All and Unread views, source links, mark read, dismiss and mark all read. Dismissal retains the database row and excludes it from the normal views. Pagination uses `(created_at DESC, id DESC)`, default 25 and maximum 50, with validated paired cursor fields. The header bell shows an accessible unread label and a small 1–9 / 9+ badge, never zero. It adds no mobile navigation item.

`OwnerNotification` exposes only id, type, title, body, actionUrl, createdAt, readAt, dismissedAt and optional petId/petName. Dedupe keys and source worker references are not serialized. `my_notifications`, `my_notification_count` and existing single-message mutation validate the caller; `mark_all_notifications_read()` accepts **no recipient parameter** and affects only `auth.uid()`.

Today displays current care/opening/appointment state, not a second copy of each reminder. Notification Center may contain the emitted reminder. A verification can appear once as an attention message and once in the distinct recent-activity section; it is not duplicated within either section.

### Appointment reminder processing

`process_appointment_reminders(now, limit)` reuses existing `appointment_reminders`; it only processes in-app rows for scheduled/confirmed/requested/waitlisted appointments that have not started. Sent or dismissed rows are ignored. The worker takes appointment row locks with `SKIP LOCKED`, locks reminder rows, inserts a message and sets `sent_at` in the same transaction. A failure rolls back both operations. The deterministic key is `appointment-reminder:{reminderId}`. Repeated or overlapping invocations cannot duplicate a message.

A late run may encounter multiple offsets: each due reminder is recorded once, while older offsets are dismissed so only the closest current reminder remains visible. Cancelling/completing an appointment, changing its title/time/timezone, dismissing a reminder or removing an offset retires stale messages. Message timestamps remain historical. No reminder emits after the appointment has passed.

The existing editor resets `sent_at` on reschedule. The same reminder UUID nevertheless keeps its once-only message identity: a later worker marks it sent without creating a replacement message. This deliberately avoids repeat-notification spam; versioned reschedule notifications are a future enhancement. Removing and later re-adding an offset creates a new reminder identity through the existing editor.

### Verification notifications

The actual successful status is **`verified`**. An AFTER trigger emits the owner's notification transactionally when the existing provider workflow transitions a request into that status (or a verified row is inserted by an authorized operational path). Key: `verification:{requestId}:verified`. No provider privilege is added. Existing request/member checks and audit writes remain authoritative.

The insertion guard checks request → vaccination → pet → household owner and the exact action path/key. Updating an already verified row does not duplicate a message. Revocation or source removal dismisses it. Pending, cancelled and other outcomes are not presented as successful verification. There is no historical backfill and no import-time burst of old verification messages.

## Security and workers

All new functions have an empty search path and explicit schema references. PUBLIC, anonymous and ordinary authenticated access to privileged functions is revoked. Existing table grants/RLS and the care/opening notification integrity triggers remain intact. A new guard validates recipient and pet against authoritative reminder/verification sources on insertion and prevents reassignment of new references on update. Existing notification identity guards prevent recipient/type/dedupe/action reassignment. Normal clients still cannot insert or update notification rows directly.

The new `pawport_appointment_worker` role is NOLOGIN/NOINHERIT and can execute only its reminder processor. It cannot read raw tables, process care reminders or run scheduling imports. `lib/notifications/worker.ts` accepts injected restricted RPC transports. `runOwnerNotificationJobs()` calls the independent care and appointment workers, with an optional existing availability callback, using settled results so one failure does not hide another. This is orchestration, not a combined privilege grant.

No production cron, browser worker invocation, public privileged endpoint or background delivery is installed. Until an operator provisions a scheduler, appointment and care messages do not emit automatically; Today still shows source state. Verification messages emit through their database transition trigger. Existing Smart Openings processing remains separately controlled.

For future scheduling: provision a server-only connection authenticated as a tightly scoped login role permitted to assume the relevant NOLOGIN worker role; keep its credential in a secret store, outside client bundles. Use separate role-scoped transports for each processor. Review scheduler authentication, limits, retry/backoff, monitoring and overlapping execution in staging before enabling a schedule. Do not grant these RPCs to `authenticated` or expose a service-role key. The worker functions are scheduler-independent and may later be invoked by a secured queue, Supabase job, or Vercel Cron adapter.

## Owner UX and preserved workflows

Home becomes Today for owners with one or more pets. Existing sign-in, onboarding, zero-pet and provider-only routing is preserved. Pets navigation now points to `/pets`, a dedicated household gallery with the existing pet cards and Add Pet flow. Each pet overview remains available. Care, Records, Services, Account, password recovery and provider verification routes are unchanged.

Today includes pet-labeled cards/avatars, coming up, recent activity, weekly counts and existing-workflow quick actions. A single pet gets direct record/moment links; multiple pets use the existing Records selector and a lightweight moment pet choice. No-data copy is “You're all set”; a populated account without attention shows “All caught up. Nothing needs your attention today.” Coming up/activity remain visible when useful.

## Testing and staging acceptance

Automated tests use isolated PGlite PostgreSQL with migrations 001–010, real SQL roles/RPCs/triggers and simulated auth/storage schemas. They do not contact production. Tests cover owner/anonymous denial, unchanged existing policies, safe DTOs, care states/snooze, appointment states, explicit dates, successful provider verification, notification recipient spoofing, dedupe, sent_at, source removal, unread/dismiss/all actions, pagination, preview bounds and multi-pet isolation. Existing care and Smart Openings database suites now run after migration 010, retaining their assertions and adding unified Center/Today checks. Render tests cover trust/copy, local midnight, spring/fall DST, single/multiple-pet quick actions and calm empty states.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` using Node 22+. Hosted integration tests remain opt-in; isolated role tests do not replace staging tests against actual Supabase/PostgREST/auth/storage.

Manual staging checklist:

1. Back up and apply migration 010 to a **separate staging project** with 001–009 already applied; inspect grants and function exposure. Use staging-only app secrets.
2. Check signed-out Home/login/password recovery and a provider-only account. Owners with no pet must still onboard. One- and multi-pet owners land on Today; Pets opens the gallery and pet overview links work.
3. Create active, paused, archived, completed and skipped routines, including a date-only task today, a timed overdue task, tomorrow and next week. Only eligible pending items appear. Complete and snooze from Today, verify source state and no duplicate card.
4. Create appointment statuses including cancelled/completed; verify today/tomorrow/week grouping and pet labels. Check local midnight and both DST boundaries with browser timezone emulation. Imported appointments remain read-only.
5. In a deliberately enabled non-production mock environment, process a watch and verify the Demo opening appears. Dismiss, age or invalidate it; it must disappear from Today. Production mock gating must remain off.
6. Add vaccinations with null/explicit due dates and different existing trust states. Confirm expiration wording and no inferred schedule. Verify an explicitly submitted record using a different authorized provider user; see one owner notification and the existing timeline event. Revoke it and confirm retirement.
7. Invoke the appointment processor through its isolated worker role in staging. Verify one message per eligible reminder, `sent_at`, repeat-call dedupe, cancelled exclusion, reschedule behavior and safe reminder removal. Repeat legacy care/opening processing.
8. Test All/Unread, mark read, dismiss, mark all read and 25-row pagination. A second household and provider must see none of the first household's private messages or Today state. Attempt raw writes and forged source references; expect denial.
9. At 390px, tablet and desktop, check readable cards, keyboard focus, bell labels, five mobile links, no overflow and bottom-safe-area clearance. Click existing quick actions. Inspect responses for forbidden private fields.
10. Only after acceptance, separately authorize any deployment or production migration. No scheduler/delivery should be enabled implicitly with this release.

## Limits and next phases

There is no new delivery channel, real scheduling adapter, booking, public profile, provider claiming or medical inference. Notification history has no automatic retention deletion. Dismissed messages are retained but have no archive browsing UI yet. No real-time database subscription is used. The 24-hour opening freshness limit still requires availability reconfirmation. Source history remains in existing tables; Today does not fabricate precise historical status-change timestamps.

Future email/push can consume verified message identities through a separate per-channel delivery/outbox design with consent, retry and delivery dedupe; do not equate an in-app `sent_at` with email delivery. No browser permission or delivery integration is requested now.

The seven-day read model, pet identity, timezone and weekly category counts provide weekly-digest inputs. A future digest should query a dedicated bounded week view, rather than treating the ten displayed cards as an exhaustive dataset. Delivery, preferences and scheduling are deferred.

Phase 7 provider claiming/business profiles can build on this owner engagement foundation while retaining the existing separation between owner care, provider verification and scheduling authorization. None of that provider product is implemented here.

## Verification for this implementation

- Lint, TypeScript and production build passed on Node 22.
- Full regression suite: 158 tests, 155 passed, 3 hosted integration tests skipped, 0 failures.
- Browser fixture checks at 390×844, 768×1024 and 1440×1000: readable cards, no horizontal overflow observed, no framework error overlay, header badge and five mobile destinations. At the mobile page bottom, the final control was above the fixed navigation; the snooze select retained a visible label and keyboard focus.
- The visual fixture used browser-only sample responses, performed no stored-data actions and was removed before the build. Real signed-out login retained Forgot password and rendered no authenticated navigation. Authenticated hosted acceptance remains a staging task; no remote migration was applied.
