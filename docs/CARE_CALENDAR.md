# Care Calendar — Phase 5A

Branch: `feature/care-calendar`. This is an owner-managed record of care arranged elsewhere, not a booking engine. No external scheduling API, background email job, migration against a remote database, merge, or deployment is part of this implementation.

## Experience and routes

- `/appointments`: all-pet timeline grouped by the viewer's local date, with Upcoming and Past & closed views, pet/type filters, 30 records per page, creation and Health Records links.
- `/appointments/new`: manual appointment form; optional `pet` UUID and `place` Google Place ID preselect only those identifiers.
- `/appointments/[appointmentId]`: edit a manual appointment, change its status, or mark it cancelled. Contains the private calendar export link.
- `/appointments/[appointmentId]/calendar`: authenticated `.ics` download; unauthorized users cannot download another household's calendar entry.
- Household home displays up to five upcoming appointments across pets. Each pet overview displays up to three for that pet. Empty states offer a direct creation action. An unavailable/missing calendar schema does not break the existing passport/dashboard.
- Service detail offers an owner-only Add appointment link. The user must arrange the appointment independently.

Desktop navigation retains Records and adds Care. Mobile keeps five destinations: Home, Pets, Care, Services, Account. Records remains reachable from Care, household Quick access and existing pet tabs. On record routes, the mobile Care section is highlighted while desktop Records remains highlighted. Auth pages and the provider workspace stay outside owner navigation; provider-only users visiting Care return through the existing root routing.

## Additive migration

`supabase/migrations/202609110005_care_calendar.sql`, applied after migrations 001–004.

No existing table, medical policy, Storage policy, share function, review function or provider function is altered. No bucket is added. There are two new tables:

### `appointments`

| Field                      | Type / rule                                                           |
| -------------------------- | --------------------------------------------------------------------- |
| `id`                       | UUID primary key, generated                                           |
| `household_id`             | Required household FK                                                 |
| `pet_id`                   | Required pet FK; exactly one pet                                      |
| `created_by`               | Required Auth user FK, derived by mutation RPC                        |
| `source`                   | `manual`, `pawport`, `external`; ordinary creation always `manual`    |
| `external_system`          | Nullable text, 1–80 chars when present                                |
| `external_connection_id`   | Nullable UUID slot for a future authorized connection                 |
| `external_appointment_id`  | Nullable text, 1–255 chars when present                               |
| `google_place_id`          | Nullable, 1–255 ASCII letters/digits/underscore/hyphen                |
| `provider_name`            | Optional user-entered label, max 160 chars                            |
| `appointment_type`         | Controlled type listed below                                          |
| `title`                    | Required nonempty text, max 120 chars                                 |
| `starts_at`                | Required finite timestamptz, 1900 through 2199                        |
| `ends_at`                  | Optional finite timestamptz, strictly after start, bounded to 2200    |
| `time_zone`                | Valid timezone name, max 100 chars; records creation/latest-edit zone |
| `status`                   | Controlled status listed below, default `scheduled`                   |
| `notes`                    | Optional private plain text, max 2,000 chars                          |
| `location_text`            | Optional user-entered location, max 300 chars                         |
| `created_at`, `updated_at` | Required timestamps                                                   |

Types: veterinary, emergency_vet, grooming, boarding, daycare, walker, sitter, training, medication_followup, vaccination, dental, other.

Statuses: scheduled, confirmed, requested, waitlisted, cancelled, completed. Status describes the owner's record; choosing confirmed does not communicate with a provider. Owners can correct any manual status, including restoring a cancelled entry through edit. No automatic completion or normal hard deletion occurs. Past scheduled appointments remain stored as scheduled history entries.

Household, pet, creator, source, external identity and creation timestamp are immutable on update. Reassigning an appointment to another pet is not supported: record a separate appointment and cancel the incorrect entry. Two pets attending together require two entries.

External rows require all three external fields; manual/pawport rows must have none. A partial unique index on `(household_id, external_system, external_connection_id, external_appointment_id)` supports idempotent future imports and avoids treating a vendor's ID as globally unique. Connection UUIDs deliberately have no FK yet: the connection/authorization table belongs to the first real adapter's implementation. Household/time and pet/time indexes support listing.

### `appointment_reminders`

`id` UUID primary key; required appointment FK and Auth `user_id`; `reminder_minutes` in 120, 1440, 10080; `channel` in in_app/email/push; nullable `sent_at`, nullable `dismissed_at`, and `created_at`. Unique `(appointment_id, channel, reminder_minutes)`; owner/appointment index.

Normal app mutations create **in_app** reminders only, with 24 hours selected by default. Users may choose none, two hours, 24 hours, one week, or combinations. Replacing choices is atomic with saving the appointment. Removing a reminder choice deletes that preference row; the appointment itself is preserved. Changing start time clears in-app dismissal/sent state so reminders follow the revised time. Normal users cannot set sent timestamps or delivery channels.

These tables cascade on authorized removal of the referenced account/household/pet. This is account-data cleanup, not an appointment delete capability exposed by PetThread.

## RLS and security

Both tables enable RLS. Anonymous roles receive no access. Authenticated roles can select only owner-visible rows and have no direct INSERT, UPDATE or DELETE grants.

Scoped SECURITY DEFINER functions use empty search paths and explicit execute grants:

- `save_manual_appointment(p_id, p_pet, p_data, p_reminders)` derives the household and creator using `auth.uid()` and the owned pet. It rejects unexpected JSON fields, including ownership and source injection. Existing-row writes require the same pet, household, creator and manual source. Row locks serialize edits; per-owner advisory locks enforce a 100-new-appointments/rolling-day limit. Concurrent edits are last-write-wins, not version-merged.
- `cancel_manual_appointment(p_id)` checks owner/manual source and updates status only; reminders/history remain private.
- `dismiss_appointment_reminder(p_id)` checks reminder and appointment ownership before setting in-app dismissal state.

Database triggers additionally verify that each pet belongs to its recorded household and that its creator owns that household, including privileged writes. Reminder triggers ensure user ownership matches the appointment household. Immutable identity checks prevent moving an appointment to another household or pet. Constraints defend invalid timestamps, lengths, enums and Place IDs independently of form validation.

Provider membership never participates in these policies. A provider-only account gets no appointments or reminders. A person who separately owns a household can manage that household's appointments as an owner; that grants no access to other households. Existing provider verification and shared-passport field allowlists are unchanged.

Appointment/list reads are cookie-authenticated and subject to RLS. Only edit pages load private notes; timeline and ICS queries omit them. React escapes user text. ICS uses a fixed download filename and content allowlist. No service-role secret is required by the app. Existing Google key boundaries remain unchanged.

## Timezone and lifecycle semantics

The database stores absolute timestamptz values. Date/time inputs are interpreted in the browser's IANA timezone, shown explicitly on the form. The form waits for client hydration before accepting input, so a server's timezone cannot silently determine an entered time. The server independently validates the submitted zone and converts wall time to UTC using `Intl.DateTimeFormat`; it does not trust a client-generated timestamp. JavaScript is required for local-time entry.

Spring-forward gaps are rejected with a clear error. Fall-back overlaps expose First occurrence / Second occurrence selectors. Conversion checks candidate offsets on both sides of the transition, including half-hour and date-line changes. Editing converts the saved absolute time into the current browser's timezone and preserves which occurrence corresponds to the existing instant. Optional end date/time supports overnight boarding. Ends must be later than starts.

Display uses the current browser timezone; changing location/timezone changes displayed wall time, not the stored instant. Server-rendered timeline placeholders use explicitly labeled UTC before hydration; local dates then determine grouping. There is no hardcoded Eastern timezone. `time_zone` is provenance for the last saved wall-time entry, not a command to freeze display in that zone.

Upcoming means `starts_at >= now` and status is scheduled/confirmed/requested/waitlisted. Past & closed includes anything already started plus cancelled/completed entries, even if their date is in the future. An ongoing appointment appears in history once it starts; no status is automatically changed. The client reevaluates reminder/upcoming display approximately once a minute while open; server lists/counts refresh on navigation or reload. Offset pages may shift if entries change concurrently. The current pagination UI allows pages 0–100, with pet/type filters narrowing the result set; all history remains in the database.

## Google linkage and manual provider entry

Appointment creation from a service page passes **only Google Place ID**. No business name, address, phone, rating, count, hours, website, photo or coordinates are copied into appointment form defaults or stored by this feature. Provider label and location fields remain blank until the owner enters their own content. They also work without a Google link, for example “Dr. Smith Mobile Vet” / “Home visit.”

Linked appointments offer Current business information, which opens the existing attributed, fresh-fetch service detail page. Calendar/home rendering makes **zero Google requests** and remains usable when Google is unavailable. This avoids a paid details request for every appointment and keeps Google content out of exports. Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) exempt Place IDs from normal caching restrictions; the existing Phase 4 attribution and public Terms/Privacy launch requirements still apply.

## In-app reminders and the next step for delivery

Reminder due time is computed from the current appointment start minus the selected number of elapsed minutes. A week means 10,080 minutes, including across DST. No scheduled copy of the due timestamp becomes stale when an appointment moves.

Timeline cards expose reminder plans and pending/due/dismissed/inactive state. Due reminders appear with a Dismiss action. Summary cards stay compact, showing due notices; detailed plans are in the full timeline. Cancellation, completion and past classification suppress active reminders. Dismissal changes `dismissed_at`, never `sent_at`: viewing the app is not email delivery.

**No emails, SMS, push notifications or background notifications are sent.** There is no cron or delivery worker configured. A reminder can be missed if the owner does not open PetThread before the appointment starts. No reminder alarms are embedded in ICS exports.

To add reliable email/push later:

1. Select a supported scheduler/queue and delivery provider; obtain explicit deployment authorization and user opt-in.
2. Add an outbox/delivery-attempt table with a unique reminder + appointment-version + channel key, claim/lease timestamps, retries, failure state and delivery-provider message ID. Do not treat `sent_at is null` alone as a safe concurrent work queue.
3. Use a narrowly authorized worker to claim due reminders transactionally. Recheck current owner/consent, status, appointment time/version and cancellation immediately before delivery; invalidated/rescheduled jobs must not send.
4. Apply idempotent delivery keys, bounded retries/dead letters, monitoring and a tested late-reminder policy. Set `sent_at` only after confirmed provider acceptance.
5. Add authenticated push subscription or private email resolution, opt-out and unsubscribe handling. Never expose credentials or recipient lookup to clients. Do not add SMS in this phase.

The email/push channel values and sent state reserve integration points; they are not proof that any delivery service exists.

## Add to Calendar / ICS

The authenticated download emits one VEVENT using UTC DTSTART and optional DTEND, title, pet name, user-entered provider/location, and an authenticated PetThread appointment URL. It uses a deterministic SHA-256-derived UID instead of exposing the appointment UUID as UID. The route URL necessarily includes the appointment reference but gives no public access. No household or Auth user identifier, private note, Google content, or reminder data is exported.

Text is escaped and lines folded at 75 UTF-8 octets without splitting multibyte characters, with CRLF endings. DTSTAMP/LAST-MODIFIED use the saved update time; status maps cancelled to CANCELLED and requested/waitlisted to TENTATIVE. An omitted end stays omitted rather than inventing a duration. This follows [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).

Download responses are private/no-store and use `text/calendar`. `CLASS:PRIVATE` is advisory; importing shares the included information with the chosen calendar provider. This is a snapshot, not a subscribed calendar or synchronization link. Updating/cancelling in PetThread does not update previously imported events automatically; calendar apps vary in how they handle reimporting a stable UID.

## Future scheduling adapters and Smart Openings

`lib/care/scheduling-adapter.ts` defines types only: `SchedulingAdapter` has listAppointments, getAppointment, listAvailability, createAppointment and cancelAppointment. No vendor implementation, token, availability request or booking invocation exists.

The first adapter must establish authorized household/provider/location connections and verified mappings from external pet references to one PetThread pet. Map timestamps with explicit offsets to absolute UTC; map vendor states/types into controlled values while retaining vendor provenance in a separate private connector store where necessary. Populate source=external, connection UUID, external system and external appointment ID. Use the unique external identity for idempotent imports; handle webhook replay, tombstones, time changes, cancellation and conflict policy. Provider/location references live on the future connection record, not as copied Google metadata. Vendor credentials stay in a server-only secret store. Add scoped connector-write RPCs for that worker; ordinary manual RPCs intentionally cannot write external rows.

No `availability_watches` table is created. Defer its schema until the first adapter's permission model and availability semantics are known. Future watches may contain pet, authorized provider/location connection, type, earliest/latest date, preferred weekdays/time window, active flag and last-checked time. A future worker would query only authorized availability, deduplicate notifications and require explicit owner action to book. Phase 5A performs none of those operations and claims no provider availability.

## Local/staging setup and production order

No new environment variable is required. Existing Supabase settings authenticate owners. `NEXT_PUBLIC_APP_URL` must match the local/staging origin and use HTTPS for production so ICS references point to the right app. A Google key is optional for the calendar itself.

1. Preserve a backup and existing record/share identifiers in an isolated staging Supabase project.
2. Apply migrations 001–004 if not already present, then `202609110005_care_calendar.sql` to that staging environment only when authorized. Do not run remote migrations against production during development.
3. Run Node 22+, `npm ci`, `npm run dev -- --port 3001`, with staging Supabase configuration. Sign in as an owner and open Care.
4. Complete the checklist below and rerun lint/typecheck/tests/build.
5. Before a later authorized production release: backup → additive migration 005 after 004 → release this application → owner/provider/share smoke checks. No email/cron configuration is required. Do not drop care tables to roll back UI code; retain owner history.

## Tests and acceptance checklist

Automated tests include real PostgreSQL authorization in PGlite with migrations 001–005, snapshots of existing rows/policies, old share validity, cross-user/provider denial, mismatched identities, creation/edit/cancellation, reminder dismissal/rescheduling, external uniqueness, timestamp and enum constraints. Time tests cover several zones, invalid dates, DST gaps/overlaps including Lord Howe and Samoa, past/upcoming filtering, reminder states and safe UTC ICS. Render tests cover pet labels, cancelled status, escaped text, empty states, creation/edit fields and Care navigation. Existing navigation tests were updated for the explicitly requested five-item mobile Care design; other regression tests remain intact.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. No real Google key or remote database is needed for offline tests. Existing hosted Supabase tests require explicit test credentials and otherwise skip. Local browser fixtures use fictional appointments and are removed before build; they do not write to any database. PGlite does not replace hosted Auth/PostgREST and calendar-import acceptance.

- [ ] Owner A with two pets creates separate appointments, including same-time appointments; household shows next five and pet pages show only that pet's next three.
- [ ] One-pet home still opens directly; global Care, Records, Services and Account remain accessible on desktop/mobile.
- [ ] Use all-pet, pet and type filters; Upcoming and Past & closed, pagination and all empty/unavailable states behave correctly.
- [ ] Edit times (including overnight), title/type/provider/location/notes/status. Cancel and restore a manual record. Historical records remain available; nothing contacts a provider.
- [ ] Select none/one/multiple reminder choices, observe due state while open, dismiss, reschedule and confirm dismissal resets. Confirm cancellation/past entries suppress active reminders. Verify sent_at stays null.
- [ ] Sign in as B and a provider-only test account. Direct queries, mutation RPCs and ICS requests for A's appointments must be denied; test mismatched IDs and spoofed JSON identity/source fields.
- [ ] Create from a Google service: only its Place ID is prefilled. Leave provider/location blank, save, remove the link, and verify the calendar works with Google unavailable.
- [ ] Create/edit in two browser timezones; compare the same absolute timestamp. Test a spring gap, both fall occurrences, non-hour offsets and local-date grouping near midnight.
- [ ] Import ICS into Apple Calendar, Google Calendar and Outlook; verify local time, optional end, escaped text, stable UID, no notes/Google content, and cancelled status. Confirm exports are authenticated and no-store.
- [ ] Check 390px mobile, tablet and desktop; five mobile targets, no horizontal overflow, last form button above bottom nav, keyboard focus and repeated-hour selectors.
- [ ] Repeat signup/login/recovery, multi-pet records/photos, share/revoke, service reviews and provider verification. Existing data and provider visibility must remain unchanged.

Known limits: manual records only; no recurrence, booking, availability, external synchronization, realtime cross-device updates or delivered notifications. UTC fallback is used before timeline hydration; local-time forms need JavaScript. Timeline pagination and concurrency behavior are described above. Clinical records are not generated from completed appointments. Live hosted acceptance, email delivery and vendor adapters remain separate work.
