# PetThread rebrand

## Brand and scope

Old brand: Pawport. New brand: **PetThread**. Primary tagline: **Everything your pet needs, connected.** Business description: **PetThread is the connected operating layer for a pet’s life.**

Started from current main `eaf9da562f62e31a0cc97a9bb1a1562d587bb6d6` on `feature/rebrand-petthread`. Product presentation changes only; no database migration, deployment, domain switch or production configuration changes.

## Initial inventory

A case-insensitive scan of every tracked text file found **454 occurrences in 152 files** (occurrences, not matching lines). It included hidden/config files, source, tests, documentation, package/lock metadata and all historical migrations. Binary assets were inspected separately. Ignored dependency/build directories and Git internals are not product source.

| Area                          | Initial occurrences |
| ----------------------------- | ------------------: |
| app                           |                  49 |
| components                    |                  73 |
| lib                           |                  27 |
| Supabase migrations/functions |                  89 |
| tests                         |                  89 |
| docs                          |                 121 |
| README                        |                   3 |
| package/lock metadata         |                   3 |

## User-facing areas updated

Shared wordmark and navigation accessibility labels; auth/signup/password-recovery shell; Home/Today; pet overview/passport and Share Pass controls; records, routines, timeline, appointments, reminders and calendar export copy; insurance and costs disclaimers; preventive guidance labels; Local Services/community and anonymous reviewer names; provider claims/profiles/team/invitations/booking/quotes; operator console and connection-sharing directions. Active product documentation uses PetThread.

Generic feature names such as Share Pass remain. Branded creation/sharing controls use PetThread Pass. No premium billing, ads or subscription functionality was added. Existing icons and all layouts/auth behavior are retained.

## Metadata and assets

Root title: `PetThread | Everything your pet needs, connected.` Application name, description, Open Graph and Twitter metadata use the new brand. Existing noindex/nofollow policy remains; no new canonical host was invented. There was no PWA manifest or email-template asset to rename.

The text wordmark is now PetThread, with the existing paw icon. `public/pawport-dog-cat-room.png` is byte-for-byte unchanged; its technical filename and CSS reference remain. The existing photography and Google attribution SVG were not altered. No visible old-brand raster wordmark was found. Calendar download filename is now `petthread-care.ics`; the stable UID namespace/hash input remains unchanged to prevent duplicate imported events.

## Compatibility boundary

The following remain intentionally unchanged: repository/package technical name; current host `https://pawport-bay.vercel.app/`; auth/callback/recovery URLs and Supabase/Vercel configuration; migration filenames and SQL; roles/RPCs/tables/storage buckets; `source='pawport'`, `pawport_live`, `pawport_guidance`; partner direction enums; `PAWPORT_*` runtime/credential configuration; Edge slugs; notification browser event names; internal Today/worker types and calendar UID namespace. No permission, consent, medical provenance or production ezyVet gate changed.

Existing SQL reader labels are presentation inputs, not a reason to rewrite historical migrations. `lib/brand.ts` translates only known system labels. Appointment labels are translated only on appointment cards; preventive explanations only in the preventive UI. Arbitrary owner/provider notes are not searched/replaced. Review UI renders the fixed anonymous label **PetThread Member**, never an identity. Partner direction options keep their submitted enum values but render brand-neutral/new-brand labels.

Raw existing RPC contracts still contain legacy labels where historically defined. Database regression assertions retain those exact values; UI tests prove the current visible brand. Existing user-authored content, historical vendor cancellation notes and external artifacts are not retroactively rewritten.

## External/manual follow-up

Review dashboard-managed Supabase email sender/template branding, OAuth consent-screen app names, Vercel project display labels, social profiles and externally hosted decks/support/legal material with their respective operators. These were not modified remotely, and their current content was not assumed. Keep current authorized redirect URLs/domain until a separately planned domain migration. Existing installed/calendar exports and historical partner messages cannot be retroactively rebranded by this source change.

## Validation

Lint, typecheck, build and the full suite passed: **382 tests, 379 passed, 3 existing hosted-environment skips, 0 failures**. Existing visible-copy assertions were updated; raw SQL enums/labels and security tests remain unchanged. Three new regression tests cover known legacy-label rendering, wordmark/metadata/hero integrity, and a source scan allowing only explicit compatibility tokens.

Local production-build browser verification covered login/signup at 390px, 768px and 1440px; forgot/reset password and Home unauthenticated shell also rendered with the new brand. The original pet hero remains visible. No browser errors were reported. Protected owner/provider/operator routes returned the branded authentication experience in this session; authenticated production data flows were not exercised manually. Their component/database/security regressions passed. No auth submission, email, deployment or remote migration was performed.

## Final reference audit

Of the original 454 occurrences, **208 were changed** and **246 retained**. Added compatibility tests/helpers and this historical audit intentionally contain old-brand strings. The table below categorizes every original file still containing a match; new helper/test matches are category 1 (compatibility), this document is category 2 (history). Category 3 (current application-visible old branding) is **zero**.

Category 1: retained technical contracts/configuration/test fixtures or explicit compatibility input. Category 2: historical migrations/documentation describing those exact contracts.

| File                                                                    | Remaining original-file occurrences | Category |
| ----------------------------------------------------------------------- | ----------------------------------: | -------- |
| `app/account/connections/[connectionId]/page.tsx`                       |                                   2 | 1        |
| `app/api/today/route.ts`                                                |                                   2 | 1        |
| `app/appointments/[appointmentId]/page.tsx`                             |                                   2 | 1        |
| `app/connections/demo/page.tsx`                                         |                                   1 | 1        |
| `app/connections/page.tsx`                                              |                                   1 | 1        |
| `app/globals.css`                                                       |                                   1 | 1        |
| `app/openings/demo/page.tsx`                                            |                                   1 | 1        |
| `app/openings/page.tsx`                                                 |                                   1 | 1        |
| `app/operator/partners/[[...segments]]/page.tsx`                        |                                   2 | 1        |
| `components/care/presentation.tsx`                                      |                                   2 | 1        |
| `components/notifications/actions.tsx`                                  |                                   1 | 1        |
| `components/notifications/bell.tsx`                                     |                                   2 | 1        |
| `components/preventive-care/presentation.tsx`                           |                                   1 | 1        |
| `components/today/care-actions.tsx`                                     |                                   1 | 1        |
| `components/today/dashboard.tsx`                                        |                                   2 | 1        |
| `components/today/presentation.tsx`                                     |                                   2 | 1        |
| `docs/APPOINTMENT_REQUESTS.md`                                          |                                   4 | 2        |
| `docs/CARE_CALENDAR.md`                                                 |                                   2 | 2        |
| `docs/CARE_PLANS.md`                                                    |                                   1 | 2        |
| `docs/CONNECTED_APPOINTMENT_OPERATIONS.md`                              |                                   2 | 2        |
| `docs/EZYVET_COMMERCIAL_READINESS.md`                                   |                                   2 | 2        |
| `docs/LIVE_BOOKING_EZYVET.md`                                           |                                   5 | 2        |
| `docs/LOCAL_SERVICES.md`                                                |                                   1 | 2        |
| `docs/PARTNERSHIPS_EXPANDED_COMMUNITY.md`                               |                                   2 | 2        |
| `docs/PARTNER_ACTIVATION_OPERATIONS.md`                                 |                                   4 | 2        |
| `docs/PAWPORT_TODAY.md`                                                 |                                   4 | 2        |
| `docs/PREVENTIVE_CARE_INTELLIGENCE.md`                                  |                                   1 | 2        |
| `docs/PROVIDER_CLAIMING.md`                                             |                                   4 | 2        |
| `docs/SCHEDULING_CONNECTIONS.md`                                        |                                   3 | 2        |
| `docs/SMART_OPENINGS.md`                                                |                                   2 | 2        |
| `lib/care-plans/worker.ts`                                              |                                   1 | 1        |
| `lib/care/ics.ts`                                                       |                                   2 | 1        |
| `lib/care/schema.ts`                                                    |                                   2 | 1        |
| `lib/openings/live-worker.ts`                                           |                                   2 | 1        |
| `lib/preventive-care/schema.ts`                                         |                                   2 | 1        |
| `lib/scheduling/mock.ts`                                                |                                   1 | 1        |
| `lib/scheduling/worker.ts`                                              |                                   1 | 1        |
| `lib/services/schema.ts`                                                |                                   1 | 1        |
| `lib/today/data.ts`                                                     |                                   4 | 1        |
| `lib/today/schema.ts`                                                   |                                   5 | 1        |
| `package-lock.json`                                                     |                                   2 | 1        |
| `package.json`                                                          |                                   1 | 1        |
| `supabase/functions/_shared/live-booking/credentials.ts`                |                                   2 | 1        |
| `supabase/functions/_shared/partners/runtime.ts`                        |                                   2 | 1        |
| `supabase/functions/partner-operations/index.ts`                        |                                   1 | 1        |
| `supabase/functions/scheduling-live-booking/index.ts`                   |                                   1 | 1        |
| `supabase/migrations/202609110004_local_services_reviews.sql`           |                                   1 | 2        |
| `supabase/migrations/202609110005_care_calendar.sql`                    |                                   1 | 2        |
| `supabase/migrations/202609110006_scheduling_connections.sql`           |                                   5 | 2        |
| `supabase/migrations/202609110007_smart_openings.sql`                   |                                   3 | 2        |
| `supabase/migrations/202609110008_care_plans.sql`                       |                                   8 | 2        |
| `supabase/migrations/202609110009_pet_timeline.sql`                     |                                   4 | 2        |
| `supabase/migrations/202609110010_pawport_today.sql`                    |                                  10 | 2        |
| `supabase/migrations/202609110011_provider_claiming.sql`                |                                   5 | 2        |
| `supabase/migrations/202609110014_appointment_requests.sql`             |                                  10 | 2        |
| `supabase/migrations/202609110015_live_booking.sql`                     |                                   7 | 2        |
| `supabase/migrations/202609110016_connected_appointment_operations.sql` |                                   9 | 2        |
| `supabase/migrations/202609110017_preventive_care_intelligence.sql`     |                                   4 | 2        |
| `supabase/migrations/202609110020_partnerships_expanded_community.sql`  |                                   4 | 2        |
| `supabase/migrations/202609110022_partner_activation_operations.sql`    |                                  11 | 2        |
| `tests/appointment-requests-database.test.ts`                           |                                   2 | 1        |
| `tests/care-database.test.ts`                                           |                                   1 | 1        |
| `tests/care-plans-database.test.ts`                                     |                                   3 | 1        |
| `tests/care-time-ics.test.ts`                                           |                                   5 | 1        |
| `tests/connected-operations-database.test.ts`                           |                                   2 | 1        |
| `tests/connected-operations-worker.test.ts`                             |                                   1 | 1        |
| `tests/ecosystem-database.test.ts`                                      |                                   3 | 1        |
| `tests/live-booking-adapter.test.ts`                                    |                                   4 | 1        |
| `tests/live-booking-database.test.ts`                                   |                                   4 | 1        |
| `tests/live-booking-worker.test.ts`                                     |                                   3 | 1        |
| `tests/multi-pet-supabase.test.ts`                                      |                                   1 | 1        |
| `tests/openings-database.test.ts`                                       |                                   4 | 1        |
| `tests/openings-matcher.test.ts`                                        |                                   2 | 1        |
| `tests/partner-operations-database.test.ts`                             |                                  11 | 1        |
| `tests/partner-operations-runtime.test.ts`                              |                                   1 | 1        |
| `tests/password-recovery.test.ts`                                       |                                   3 | 1        |
| `tests/preventive-care-database.test.ts`                                |                                   1 | 1        |
| `tests/preventive-care-ui.test.ts`                                      |                                   2 | 1        |
| `tests/provider-claiming-database.test.ts`                              |                                   2 | 1        |
| `tests/rls.test.ts`                                                     |                                   1 | 1        |
| `tests/scheduling-adapter.test.ts`                                      |                                   5 | 1        |
| `tests/scheduling-database.test.ts`                                     |                                   4 | 1        |
| `tests/services-database.test.ts`                                       |                                   1 | 1        |
| `tests/services-security.test.ts`                                       |                                   1 | 1        |
| `tests/today-database.test.ts`                                          |                                   3 | 1        |
| `tests/today.test.ts`                                                   |                                   2 | 1        |
| `tests/verified-supabase.test.ts`                                       |                                   1 | 1        |

Including the new compatibility helper/tests and this audit, the complete final scan contains **292 occurrences**: **164 category 1**, **128 category 2**, **0 category 3**. These totals count content, not filename matches.
