# Preventive Care Intelligence — Phase 9A

## Product goal

Pawport organizes what is recorded, what is scheduled, what owners choose to remember, and general topics to discuss with a veterinarian. It does not determine what medical treatment a pet needs. The pet care hub is `/pets/[petId]/care`; `/care` remains the overall owner care experience.

## Trust architecture and source taxonomy

The database read model emits separate `itemType`, `sourceType`, `sourceLabel` and `trustLevel` fields. React does not decide which sources are verified.

| Source               | Label                            | Trust level   |
| -------------------- | -------------------------------- | ------------- |
| `vet_verified`       | Vet verified                     | authoritative |
| `document_supported` | From your uploaded record        | supported     |
| `owner_entered`      | Owner entered                    | owner         |
| `care_plan`          | Your care plan                   | owner         |
| `appointment`        | Scheduled appointment            | owner         |
| `pawport_guidance`   | Pawport preventive-care guidance | guidance      |

Appointment `owner` trust means it is a scheduled organizational item, not medical verification; it does not override the appointment's provider-managed source. Vaccination provenance comes directly from the existing `owner_vaccination_trust` function. Document attachment and owner actions never promote trust. Guidance has a separate type with a null date and constant guidance trust, and it cannot enter the record-fact query.

There is no generic medical-recommendations table and no duplicate vaccination, appointment, document or care-occurrence storage.

## Guidance sources and rules

Migration: `supabase/migrations/202609110017_preventive_care_intelligence.sql`.

`preventive_guidance_sources` stores citation metadata, publication year, review timestamp and active status. The initial catalog uses the [2011 AAHA/AVMA Preventive Healthcare Guidelines](https://www.aaha.org/resources/2011-aaha-avma-preventive-healthcare-guidelines/), whose current AAHA overview was checked September 12, 2026. The guideline year is 2011; the webpage displays May 10, 2019 as its publication date. These are distinct dates, not a claim of a new 2026 guideline.

Eight rules cover four broad topics for each of dogs and cats: wellness visits, dental discussion, parasite prevention discussion and vaccination-record review. These are short original paraphrases of high-level topics supported by the source. No copyrighted guideline documents, drug names, treatment intervals, test schedules or doses are stored. There is no runtime website scraping, ingestion or LLM call.

`preventive_guidance_rules` requires a source, stable rule key, positive version, controlled species/category, bounded text, priority and active status. Priority affects presentation order only. All seeded life stages are null. `preventive_rule_applies` centralizes active source/rule, exact normalized Dog/Cat species and null-life-stage eligibility. Other, missing or unrecognized species yield no general guidance. The current pet schema itself requires Dog, Cat or Other; no schema relaxation was added.

## Rule versioning

Rule identity/key cannot be changed. Meaning-bearing edits require a strictly greater version. The suggestion identity is `guidance:{rule_key}:{version}`. Owner state records the version acted upon. Later content revisions do not automatically erase dismissals or resurface discussed topics; details show a version mismatch and the owner may explicitly show a topic again. Disable or replace a rule instead of repurposing its key. Inactive source/rule content disappears from current views without deleting owner state.

## MEDICAL CONTENT GOVERNANCE

- Use reviewed, attributable primary sources; store only citation metadata and concise original wording.
- Every rule needs a stable source, key, version and visible content review date.
- Review source updates and wording changes explicitly in a migration/code review. Never dynamically replace content from an external website.
- No diagnostic rules, symptom triage, drug/dose recommendations, inferred disease or medical urgency.
- No inferred vaccine intervals, individualized core/non-core classification, legal compliance claims or personalized testing schedule.
- No universal age thresholds or lifestyle-based treatment rules in this release.
- Publisher attribution is not publisher endorsement or veterinary verification. “Content reviewed” records a source/content check; it is not a professional credential badge or a claim that a clinician reviewed an individual pet.
- Before broader clinical content, arrange qualified veterinary content review and document responsibility, evidence and scope. Keep initial discussion wording conservative.
- Periodically recheck the catalog, its links and publication dates. The source `reviewed_at` is displayed as `contentReviewedAt`; update it only after checking every active rule using that source. Disable stale or uncertain content while it is reviewed.

## Owner preventive profile

`pet_preventive_profiles` stores only explicit owner choices: indoor/outdoor lifestyle, social contact, travel, boarding/grooming/daycare, wildlife exposure and a private note of at most 500 characters. Unknown is represented by null, including boolean questions. Save replaces this small profile through an owner-only RPC.

The profile is a private discussion aid. **It does not participate in initial rule eligibility** and cannot generate a date, diagnosis or medication recommendation. No values are inferred from journal entries, symptoms, GPS, searches, appointments, reviews or Google information. The page has no symptom questionnaire.

## Guidance state and snoozing

`pet_preventive_guidance_states` stores current personal organization state: active, snoozed, not_relevant or discussed. The database derives authenticated owner and current rule version; browser-supplied identity, source or trust is not accepted. Unique pet/rule/user identity prevents duplicate state rows. Ownership and pet/rule identities cannot be moved.

One-week, one-month and three-month presets set a date; month presets clamp to a valid calendar day. The database validates the owner's IANA timezone and a future date no more than 93 days away. A snoozed topic reappears on that local date. Expired snoozes retain their original organizational state for reference. Discussed and not-relevant topics remain accessible through Saved discussion preferences and can be restored explicitly.

“Remind me later” means resurface in the preventive-care page. The UI says **no notification or message is sent**. No notification type, worker or recurring nag is added. Existing appointment and owner care reminders continue unchanged. None of these actions mark medical care complete or confer veterinarian approval.

## Due-date and vaccination safety rules

The existing `vaccinations.due_on` is the only vaccination date used. `administered_on`, vaccine name, uploaded documents, age and lifestyle never calculate a next date.

- Stored date before the owner's local date: record expired.
- Stored date equal to today: record expires today.
- Future stored date within 90 days: coming up.
- Missing date: other records, with “No next date is recorded. Ask your veterinarian when this is next due.”
- Later dates remain accessible under other vaccination records and the authoritative records page.

“Needs attention” includes only stored record expirations, with their existing provenance shown. An owner-entered date is labeled owner entered; it is a structured record fact, not a vet-verified medical deadline. No guideline suggestion appears there. The empty state says “No record-based items need attention right now,” not “everything is up to date” or “fully protected.” Verification queues and their status semantics remain unchanged; this release does not infer new verification tasks.

Date-only record values are formatted without shifting the calendar date across timezones. Timed appointments/routines display their stored schedule timezone. Attention classification and snooze resurfacing use a validated browser IANA timezone through a private, no-store endpoint.

## Read model, appointments and care plans

`my_pet_preventive_care` returns safe pet identity, needsAttention, upcoming, routines, records, guidance and savedGuidance DTOs. Stable IDs derive from source records. No household IDs, auth IDs, storage paths, internal verification notes, connection IDs or profile notes are returned in that read model.

Upcoming contains scheduled/confirmed future appointments and real pending care-plan dates in a 90-day window, plus explicit record dates. Completed/cancelled appointments are excluded. Active routines use `snoozed_until` before `scheduled_for`; paused/archived plans are excluded. Owner routine instructions are not interpreted medically. A routine may appear in both Coming up (dated context) and Your routines (management context); it is the same stable item, not a duplicated database record.

Reads are bounded: up to 50 record/coming-up/routine items per section, 25 upcoming appointments, 50 guidance rules, and 20 pets in the household summary. Counts reflect the displayed bounded set. Existing pet/source indexes and unique pet/rule state index support these access paths; no speculative index was added. The summary reuses the same database normalization rather than independently interpreting records. Larger histories remain in Records, Care Plans and Appointments.

## Owner experience and accessibility

The pet-level Care link coexists with Overview, Records, Timeline and existing navigation. Pet overview and global Care show compact organizational counts and a link, without a health score. The pet hub keeps source, date and action together in familiar green/cream cards.

Guidance detail shows general information, why the species-generic topic appears, discussion prompt, source link/year, content review date, version and saved preference. Source links use `noopener noreferrer`. All provider/source text is escaped React text. Guidance badges have words and distinct styling rather than a verification checkmark. Forms have visible labels, keyboard-native controls, bounded notes and status/error feedback. The mobile layout reuses existing responsive care styles.

“Ask at next appointment” is only a link to the next existing scheduled/confirmed appointment. It adds no provider-visible note. “Create a care plan” opens the existing empty creation flow; it does not prefill a drug, medical date, dose or recurrence and does not create a plan automatically.

## Today, Timeline and sharing boundaries

- **Today:** continues using existing factual care/appointment/record dates. No general guidance cards or preventive notifications are injected.
- **Timeline:** guidance/state/profile changes are not historical medical events and are not inserted into Timeline. Actual care-plan history continues through its existing path.
- **Share pass:** existing public health passport output is unchanged. No preventive profile, private note, topic, snooze or dismissal is shared.
- **Providers:** generalized business members and veterinary verification members have no preventive-profile or discussion-state access merely from those roles. No automatic sharing, medical authority, scheduling permission or review powers are granted.

## RLS and security

All four new tables have RLS and revoked direct anonymous/authenticated access, including the curated catalog. SECURITY DEFINER RPCs use an empty search path, explicit grants, and the existing pet→household→owner relationship. Only narrow owner reads/mutations are exposed. Internal eligibility and normalization helpers have no browser grants. Rules and sources have no browser mutation path.

Save rejects unknown JSON keys, invalid enum/type values and oversized data. Current user, ownership and rule version come from the server/database. The HTTP read endpoint authenticates before calling RPCs and uses `Cache-Control: private, no-store`; pages are dynamic. Server Actions retain Next.js origin protection and repeat ownership checks in the database.

## Known limitations and review process

General guidance is dogs/cats only, species-generic and intentionally small. There is no diagnosis, symptom triage, medication/dose advice, inferred vaccine interval, local-law determination, personalized laboratory schedule, medical health score, automatic provider sharing or AI medical recommendation. No insurance, claims, cost planning or provider marketing is built. Guidance needs periodic human review; no automatic review scheduler is installed. Reminder dates resurface topics in-app without delivery. No historical content snapshot archive or admin content UI exists; version/key/source governance is enforced and documented for migration review.

Before future content changes: verify the primary source; draft conservative original wording; assess whether clinical expertise is required; increment rule version or replace the key; preserve owner state; update the review timestamp only after catalog review; run trust/eligibility/date/privacy regressions; explicitly disable uncertain content. Production clinical expansion needs professional review beyond this implementation's source check.

## Phase 9B readiness

Pet, appointment and document identities remain authoritative and separate from guidance. Future insurance may reference those records and a separately designed cost history without using insurance coverage to determine medical guidance, trust or eligibility. This phase adds no insurance coupling.

## Local validation

September 12, 2026: `npm run lint`, `npm run typecheck`, `npm run build` and `npm test` passed. The full suite reported **303 passed, 3 existing hosted-environment skips, 0 failures** (306 total), including 19 new preventive-care tests. The existing Phase 8C recheck-deduplication fixture was stabilized to keep its appointments on one UTC day; its assertions were not relaxed.

New coverage includes owner/provider/anonymous isolation, profile validation and privacy, immutable state identity, source/version governance, discussed/snoozed states, dog/cat/unsupported eligibility, life-stage fail-closed behavior, explicit and missing vaccination dates, real provenance, appointment/routine source labels, paused/cancelled exclusions, timezone date boundaries, DST formatting, public share-pass exclusion, safe empty states and accessible source text.

Browser checks used a temporary local fixture rendering the actual components at 390px and 1440px. Source labels, responsive layout, no horizontal overflow, native labeled form controls and keyboard activation of the three-month preset were checked; no console errors appeared. The fixture was removed before building. These local checks do not replace hosted authenticated/Storage regression tests. No remote migration, deployment or real-user data change was performed.
