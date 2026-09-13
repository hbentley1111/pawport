# Care plans & recurring reminders — Phase 6A

PetThread remembers the schedule an owner enters. It does not decide what care a pet needs, recommend medication, calculate doses, infer schedules, or change verified medical information. Every routine is labelled **Owner-entered routine**. A vaccination reminder is separate from the vaccination record, provenance, and veterinary verification. Completion records that the owner marked a task complete; it is not clinical evidence.

## Schema and migration

Apply `supabase/migrations/202609110008_care_plans.sql` after migrations 001–007, including `202609110007_smart_openings.sql`. This change has not been applied remotely.

- `care_plans`: immutable household, pet, creator, source (`owner_entered`), bounded title/category/instructions, normalized recurrence, IANA time zone, local anchor date/time, optional end date, active/paused/archived status, schedule revision, timestamps.
- `care_plan_occurrences`: plan ID, schedule revision and sequence, absolute scheduled time, optional snooze time, pending/completed/skipped/cancelled status, completion/skip timestamps and optional note. Title/category/time-zone snapshots preserve the context of past care even when the plan is renamed. Unique `(plan_id, revision, sequence)` plus a partial unique pending index enforce idempotency and one pending occurrence.
- `care_plan_reminders`: unique plan/channel/offset, `in_app` only; offsets 0, 120, 1440, 4320 and 10080 minutes.
- Existing `notifications`: retains `availability_match`, adds `care_due`, widens only the type and local action URL checks, adds nullable occurrence/offset references with care-specific constraints. Existing availability notifications and identity/recipient checks remain unchanged.

There are no new vaccination, appointment, pet, review, or provider policy changes. No normal hard-delete RPC is exposed. Archived data stays private and retained.

## Recurrence and timezone

`care_scheduled_at` is the single calendar implementation. Routes never repeat recurrence calculations. The database validates the zone against PostgreSQL's timezone catalog; the form defaults to the browser's IANA zone and validates it server-side too. The stored plan zone controls subsequent display, independent of travel/browser changes.

Supported schedules: one-time or every 1–365 days/weeks/months. Each sequence is computed directly from the **original anchor**, then converted with `AT TIME ZONE` to `timestamptz`. Daily routines use local calendar days, not successive UTC 24-hour additions. Weekly routines use local multiples of seven days. January 31 monthly becomes February 28/29, then March 31. End dates are inclusive local dates. Occurrences beyond 2199 or the end date are not generated.

PostgreSQL's deterministic DST resolution is intentional: a nonexistent spring local time advances by the gap (02:30 becomes 03:30 on that date); an ambiguous fall time uses the standard-time/later instant. Following occurrences return to the intended clock time. A routine scheduled at 20:00 stays at 20:00 across ordinary DST changes. Date-only plans use 09:00 local internally for reminder timing and omit time from the card; they are labelled overdue only after their local due date has passed.

Two daily doses are represented as two owner-entered routines in this phase. There are no cron strings, dosage suggestions, or inferred schedules.

## Occurrence lifecycle

All mutations lock the plan before the occurrence. `complete_care_occurrence` and `skip_care_occurrence` preserve the old row, set the appropriate timestamp, dismiss obsolete notifications and generate one next sequence only if active. Repeating an action on a resolved row is a no-op. The unique pending index is a second concurrency barrier.

The next occurrence follows the scheduled anchor, never the completion or snooze time. September 1 completed on September 2 still advances to October 1. If an owner is many intervals late, the next item may still be overdue: PetThread does not invent missed completions or silently discard missed care. They may skip it or edit the future anchor. Only one pending item is ever generated, including for an overdue backlog.

One-time or ended plans remain visible under Finished / history with no pending item. They remain active until the owner pauses/archives them. Completed and skipped rows cannot be rewritten, moved between plans, or reclassified through application RPCs.

Changing recurrence, zone, anchor or end date increments the schedule revision, cancels the pending row and generates the new anchor if active. Editing labels/instructions keeps the pending identity and updates its label snapshot only. Historical snapshots remain unchanged. Editing a paused schedule defers generation until resume.

Pause retains the pending row, suppresses notifications, and disallows completion/skip until resumed. Resume keeps that item even if overdue; when a paused schedule was edited it creates sequence zero of the new revision. Archive cancels the pending occurrence, dismisses notifications, retains history, and is terminal; there is no implicit restore.

## Snooze

Effective due = `snoozed_until ?? scheduled_for`. Original due time remains visible in detail/history. Presets are in two hours, tomorrow at this local clock time, three local days, one local week, and custom date/time. Calendar-day presets use the plan's zone; custom DST gaps are rejected with a validation message, and folds choose the later instant.

Snooze must be later than both now and the original scheduled time, within 30 days of the later of those, and no later than 400 days from occurrence creation. The latter is an absolute stop against indefinitely extending the same occurrence. For very old backlog items, complete/skip or edit the future schedule instead. Snooze never changes the recurrence anchor.

## Notifications and worker

`processCareReminders(rpc, now, limit)` in `lib/care-plans/worker.ts` is server-only. It delegates to the transactional `process_care_reminders` RPC. The database finds active pending occurrences with due offsets against effective due time; locks candidate plans with `SKIP LOCKED`; and creates notifications addressed only to the household owner. Batch limit 1–500, default 200 plans. Previously processed candidates do not starve later batches.

Dedupe key: `care:{occurrence_id}:{reminder_minutes}`. Completed/skipped/cancelled occurrences and paused/archived plans cannot create reminders. When a worker is late, superseded earlier offsets are recorded dismissed, and only the latest eligible offset remains visible. A newer offset dismisses older offset notifications. Completion, skip, pause, archive, snooze, or plan edits dismiss obsolete notices.

**At most one notification per occurrence/offset, including after snooze.** An offset already delivered/dismissed is never reissued. Offsets not previously processed use the new snoozed due time. This prioritizes no spam; Care always shows the current effective due state. Plan edits that retain the occurrence identity likewise do not reissue an already delivered offset. New schedule revisions get new occurrence identities.

`my_care_notifications` returns only the signed-in owner's latest 50 non-dismissed care notices. The existing `mark_notification_read` RPC handles read/dismiss without permitting recipient changes. Smart Openings continues using its existing DTO and dedupe scheme.

### Exact next step for scheduled delivery

No cron, email, push, new secret, or public worker endpoint is installed. Until an operator configures a worker, due cards work normally but automatic notifications are not generated; the UI states this.

The migration creates `pawport_care_worker` as **NOLOGIN NOINHERIT**, with only schema usage and execute on the care-processing RPC, separate from the scheduling worker. It is not granted to `authenticated`, `anon`, `authenticator`, or provider members. A future operator must provision a dedicated server-only SQL transport with authorization to assume that role (or a tightly scoped signed worker identity), keep credentials in a server secret store, then call `processCareReminders` from a queue, Supabase scheduled job, or Vercel Cron. Bound batch count/runtime and add retries/monitoring; never expose the worker RPC through an owner server action or use browser credentials. Do not grant general table access. No email/push delivery should be claimed until a separate channel integration is implemented.

## Privacy and authorization

All three new tables have RLS enabled and no direct browser read/write grants; owner access is through narrow SECURITY DEFINER RPCs with empty search paths and explicit ownership checks. All helpers have default PUBLIC execute revoked. Backend-only helpers are not executable by authenticated users or the scheduling worker.

`save_care_plan` derives household and creator from the authenticated pet owner and allowlists fields. A trigger independently validates household/pet/creator consistency and immutable identities. Owner DTOs omit household and creator IDs; pet IDs remain only in private owner views. Occurrence history cannot be moved or rewritten. Care notification triggers verify recipient, occurrence, action URL, and deterministic key. Provider verification membership grants no care access.

Limits: 50 active plans per pet; 50 new plans per owner in a rolling 24 hours. A shared owner advisory lock serializes creation and resume against limits. Title 120, instructions 1000, note 500 characters, five allowlisted reminders. List RPCs are bounded to 1000 rows and 100000 offset; list UI pages 50 at a time. Detail fetches a specific owned plan independently of list pagination and returns the most recent 100 historical occurrences; older history remains stored for a later paginated timeline.

## Owner experience

- Global desktop/mobile Care points to `/care`. Appointments, Openings and Records remain accessible; owner/provider/auth routing is preserved.
- `/care`: appointments/routines/openings entry cards, near-term care and in-app care notices.
- `/care/plans`: all-pet filter, Due now, Upcoming, Finished/history, Paused, Archived/history, completion and snooze access.
- `/care/plans/new`: labelled mobile-friendly owner routine form.
- `/care/plans/[planId]`: owner schedule, instructions, effective/original due, reminders, complete/skip notes, snooze, edit, pause/resume, archive and recent history.
- Household home: overdue and next-seven-local-date items, at most three; honest empty state.
- Pet overview: up to three active pending items for that pet. Existing records/vaccinations, appointments, share controls and Smart Openings remain.

Private routine text renders as escaped React text. No HTML injection, Google content, vendor data, secret values, diagnosis inference, or new verification badge is introduced.

## Tests and acceptance

Automated isolated PostgreSQL tests apply the full migrations and check tenant isolation, narrow execution grants, immutable history/identities, lifecycle, one pending index, duplicate/queued concurrent completion, local recurrence, monthly clamp, leap years, end dates, edits, snooze and notification ownership/dedupe. Existing Smart Openings database tests also apply migration 008 before running their unchanged pipeline assertions. Render/validation tests cover labels, due states, local snooze presets, pet filtering, safe text, empty states, navigation and worker boundaries.

Queued concurrent PGlite calls and database uniqueness are tested; independent-session hosted PostgreSQL contention remains a staging acceptance check. Hosted tests require explicit test credentials and must never target production fixtures.

Manual acceptance on an isolated local or staging database:

1. Apply 001–008 in order; use test-only accounts A/B and at least two A pets. Never run a reset or destructive fixture script on production.
2. Create a one-time and interval routine for each pet; verify global Care and per-pet filtering. Check 390px, tablet and desktop; keyboard labels/focus and bottom-nav clearance.
3. Complete the same occurrence from two tabs concurrently. Verify one immutable completion and exactly one next pending row. Repeat with skip. Check notes and snapshot title after renaming.
4. Verify January 31, leap February, 20:00 across spring/fall, DST gap/fold behavior, optional time and end dates.
5. Snooze tomorrow/custom; original scheduled time remains; cadence survives completion. Reject past/oversized snoozes.
6. Pause and run the restricted worker in the isolated database; no new notice. Resume retains pending; archive cancels pending and cannot restart.
7. With a test worker transport, call processing twice: one visible current-offset notice, no duplicates. Snooze/complete/skip dismiss old notices. Verify A cannot see or mutate B data/notifications.
8. Exercise Smart Openings notifications after migration 008, manual/external appointment behavior, Records, Services/reviews, password recovery, provider verification, and one-/multi-pet navigation.
9. Confirm no email/push is sent and no scheduling vendor is contacted.

## Release order and limitations

Keep this feature branch unmerged until reviewed. For a later authorized release: back up the target database; apply prerequisites 001–007 then additive 008 to staging; run acceptance including separate-session contention; release application code to staging; configure a restricted worker only after reviewing transport authorization. Production migration must precede application release when separately authorized. The app handles an absent care migration with an unavailable message rather than breaking the existing dashboard. No migrations or deployment are performed by this task.

Limitations: one time per plan/day; no automatic external delivery; date-only reminders at 09:00; deliberate backlog retention; one notification per offset even after snooze; terminal archive; latest 100 history entries in detail. No clinical advice, system-derived vaccine reminders, unified timeline, Today redesign, booking, vendor integration, or new provider privileges.

## Phase 6B timeline readiness

Read authorized `care_plan_occurrences` joined to the owned plan/pet, using `completed_at` / `skipped_at` as event time and snapshot fields as display context. Examples: “Heartworm prevention completed”, “Medication skipped”, “Grooming routine completed”. Preserve the owner-entered provenance. Do not convert care events into medical verification. Historical rows survive schedule edits and archive; an additional paginated timeline DTO can expose older rows without loosening table access.

## Phase 6C PetThread Today readiness

Pending occurrences plus active plans and effective due time answer overdue/today/this-week questions in the plan zone. Completed/skipped timestamps and plan updated_at identify recent changes. Reuse `dueLabel`/`relevantPlans` and add bounded database due-window queries at larger scale. Stored occurrence snapshots and immutable source preserve provenance. No full PetThread Today dashboard is built here.

## Verification recorded for this branch

- `npm run lint`, `npm run typecheck`, `npm run build`: passed locally.
- `npm test`: 134 tests; 131 passed, 3 existing hosted-database tests skipped pending explicit test environment credentials.
- Responsive browser fixture checks: 390×844, 768×1024, 1440×1000; no horizontal overflow or browser errors; mobile submit control clears the fixed bottom navigation; navigation changes at the expected breakpoint. The fixture was removed before the production build and is not committed.
- Unauthenticated `/care` redirected to `/login`. No authenticated browser mutations were submitted to the configured remote database. Isolated PGlite tests exercise real migrations/RPCs; full staging acceptance remains to be run after an authorized staging migration.
