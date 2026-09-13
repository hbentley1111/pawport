# Pet Insurance & Coverage — Phase 9B

Pawport organizes information an owner records about coverage, private documents and claims. It does not sell, solicit, quote, compare or recommend insurance; act as a producer, broker, adjuster or insurer; submit or adjudicate claims; or determine treatment eligibility. The insurer and policy documents determine actual coverage, benefits, exclusions and claim decisions.

## Insurance and wellness

`accident_only`, `accident_illness` and `insurance_other` represent owner-entered insurance records. `wellness_program` displays **Wellness plan — not insurance**. The carrier/program name is free-form owner data, not a certified carrier catalog. Wellness membership identifiers and plan documents remain distinct from insurance policy wording.

## Provenance

Plan evidence is `owner_entered` or `document_attached`. Only a ready policy, insurance-card or renewal-notice document changes the plan's evidence label. Retiring the last supporting document restores Owner entered. Other attachments, such as receipts, do not establish policy evidence. Terms remain owner entered even when a document exists. No extraction, OCR or AI interpretation occurs.

`carrier_verified` is reserved in the vocabulary but database checks prohibit creating it in this phase. Claim source is always owner entered. A future integration requires an additive, permissioned design that preserves owner-entered versions; it cannot silently relabel historical terms. Insurance provenance never uses veterinary verification.

## Coverage and sensitive identifiers

`pet_coverage_plans` belongs immutably to a pet, household and authenticated creator. It stores kind, owner-selected status, issuer/program and plan names, optional identifiers, explicit dates, phones, HTTPS portal and private notes. No normal hard-delete workflow exists: owners record expired/cancelled status without deleting history.

List and dashboard DTOs contain `planId`, `petId`, `carrierName`, `planName`, `coverageKind`, `coverageLabel`, `status`, `maskedPolicyNumber`, `renewalOn`, provenance/label and open-claim count. Masking happens in PostgreSQL; fewer than four characters yields only bullets. Wellness summaries mask the member number. Full identifiers are limited to authenticated owner detail/edit data, never summaries, Today or public routes. Accessible masking announces the ending digits.

Portal links require HTTPS, use `noopener noreferrer`, and are never fetched server-side. No portal credentials are requested. Notes are escaped plain text, not HTML.

## Versioned financial terms

`pet_coverage_terms` has unique `(plan_id, version)`. All financial edits, including corrections, append a version. The RPC locks the plan before allocating `max(version)+1`. Update/delete triggers protect historical terms, whether or not claims exist. Current means greatest version, not newest timestamp. Claims do not yet reference a specific term version.

USD only. Monetary fields use integer cents, bounded from zero to 9,000,000,000,000 cents for safe application transport. Decimal form inputs are converted using integer arithmetic. Reimbursement percent is 1–100. Unlimited annual limit excludes a numeric limit. No benefits, entitlement, remaining deductible or out-of-pocket figure is calculated.

Waiting-period dates/notes are explicit owner input only. Purchase dates do not imply waiting periods. Policy notes are organizational; there is no exclusion, pre-existing-condition, service-to-policy or medical coverage engine.

## Private documents

`coverage_documents` is separate from health documents. Supported types are policy/plan document, insurance card, renewal notice, claim form, EOB, invoice, receipt, correspondence and other. PDF/JPEG/PNG only, up to 10 MiB. SVG and other types are rejected. An invoice containing medical text remains an insurance document.

The private `insurance-documents` bucket uses server-generated `insurance/{household}/{pet}/{uuid}` keys. `prepare_coverage_document` authorizes the owner, validates filename/type/size and creates pending metadata; the authenticated upload proxy uploads using that owner's Supabase session. `finalize_coverage_document` locks the plan/document and checks actual storage metadata before marking ready. Finalization is idempotent. Pending uploads expire after one hour and are retired lazily during preparation. File signatures are checked during application upload and download; this is format validation, not content extraction or malware scanning.

Normal browser JSON includes IDs and safe document metadata, not storage paths. Prepare/delivery RPCs are owner-authorized internal transport helpers used by the Next.js proxies; they resolve only that owner's generated keys. Knowledge of a key does not authorize access. The normal app contains no service-role key.

`/insurance/documents/[id]` authenticates ownership on every download and proxies bytes with `Cache-Control: private, no-store`, no-referrer, nosniff, forced attachment and sandbox CSP. No public or transferable permanent document URL is created. Download filenames are descriptive. Retired documents disappear from normal lists/delivery and claim links; history and physical objects remain. Physical cleanup is future maintenance.

Storage RLS permits only owner-ready reads and owner-pending inserts. Restrictive guards prevent permissive policies from another feature granting insurance access. No browser overwrite/delete is allowed. Existing health, pet-photo and business-logo bucket rules remain intact.

## Claims and history

`insurance_claims` fixes plan, pet, household and creator. Claim number, service/provider text, dates, amounts and notes are owner entered. Provider names do not link automatically to Google, veterinary providers or business locations. No appointment-to-claim conversion or carrier submission exists.

Statuses are draft, submitted, received, in_review, more_information_needed, approved, partially_approved, denied, paid and closed. UI consistently says **Status you recorded**. Owners may correct a recorded status; this is not a carrier-enforced transition graph. Draft is the default. Draft/more-information-needed are organizational Needs action; submitted/received/in-review are In progress; the remainder are Completed without clinical or emotional judgment.

Submitted, approved, reimbursed and owner out-of-pocket amounts are independent nonnegative cents. Pawport imposes no simplistic `approved <= submitted` equation and calculates none of these values. Service and submission dates need not follow a guessed insurer workflow.

`insurance_claim_events` is append-only. Creation, status change, amount change, document attachment/removal and closure are recorded transactionally. Repeating an unchanged status adds no status event. No document text, full claim number or raw audit payload is stored in events. Detail exposes the most recent 100 normalized events without actor UUIDs.

`insurance_claim_documents` links only ready documents from the same plan and pet (therefore the same household). Attachment is idempotent. Retiring a linked document appends removal events before removing links. Neither claim status nor document events change medical records or permissions.

## Renewal awareness and integration boundaries

Only explicit `renewal_on` drives awareness. Past dates say Recorded renewal date has passed, never infer Coverage expired, and never mutate owner-selected status. Summary next renewal is the smallest explicit future date.

Today independently reads up to three owner renewal dates within 30 days using the owner's validated IANA timezone. They appear in a small Recorded renewals section with Owner-entered coverage record as source. They do not enter medical attention counts, create notifications or repeat claim-follow-up nags. Failure of this optional read does not prevent existing Today data loading.

Timeline remains pet history and receives no policy/claim events. Preventive-care guidance neither reads nor reacts to insurance. Share Pass SQL/output is unchanged: no insurer, identifiers, terms, documents, claim status, reimbursements or notes. Business members, veterinary verifiers and scheduling managers have no access through those roles. No insurance is sent to ezyVet, appointment requests, Smart Openings, reviews or Local Services.

## Owner experience

- `/insurance`: per-pet coverage cards, open claims and recorded renewals; neutral no-data state.
- `/pets/[petId]/insurance`: pet hub and Add insurance or wellness plan.
- `/new`, `/[planId]`, `/[planId]/edit`: create/detail/edit, private identifiers, term history/new version, documents and claims.
- `/[planId]/claims`, `/claims/new`, `/claims/[claimId]`: grouped claims, recording/editing, linked documents and history.

A constrained catch-all page handles these paths, validates UUIDs and checks pet/plan/claim ownership in PostgreSQL. Pages are dynamic/private. Account, the pet dashboard and Care's secondary navigation link to coverage without adding another crowded pet tab. Dashboard summaries use masked data only. No-data copy does not judge an owner's insurance choices.

Forms use visible labels, keyboard-native controls, status/error announcements, non-color status/source text and mobile cards. Sensitive identifiers remain secondary in detail. The disclaimer persists on owner coverage/claim pages.

## Security, limits and performance

Migration: `202609110018_pet_insurance_coverage.sql`. Six new tables have RLS; direct PUBLIC/anonymous/authenticated table access is revoked. Narrow SECURITY DEFINER RPCs use an empty search path and derive ownership from auth.uid and the existing pet/household model. Private helpers are not browser executable. The storage predicate alone is callable anonymously because guards also participate in other buckets’ public reads; with no authenticated owner it returns false and exposes no metadata. Identity, claim-link and history triggers provide additional integrity checks.

Limits: 25 plans per pet, 100 term versions per plan, 200 claims per plan, 100 nonretired documents per plan, 50 upload preparations per owner/day. Text and date limits are database enforced, with technical date bounds 1900–2199. Plan locking serializes term allocation, claim updates and document finalization. Upload quota uses an owner advisory lock as well as plan locking. Indexes cover pet plans, plan claims/documents and per-claim event ordering; unique plan/version and claim/document indexes serve their respective lookups. Reads are bounded by these write limits; cursor pagination is future work if those limits expand.

## Verification and limitations

Local PGlite tests apply the complete migration chain and exercise owner/foreign/anonymous/business/verifier access, immutable identities/history, reserved provenance, masking, terms, all claim statuses, document validation/linking/retirement, explicit renewals, Share Pass and preventive-care separation. Concurrent API submissions test version allocation on the embedded database; this is not a hosted multi-session load test. Existing full regression tests cover scheduling, provider, review, medical and storage behavior.

Browser verification uses actual components with synthetic data on a temporary local fixture: mobile layout, labeled controls, wellness distinction and error console. Hosted authenticated uploads and multi-user browser flows require a disposable Supabase staging environment; no remote migration is applied here.

Known limitations: owner-entered coverage only; no carrier verification/API; no claim submission, direct pay or preauthorization; no coverage/benefit determination; no insurer recommendations, quotes, comparison, affiliate links or sales; no AI/OCR/exclusion inference; no payments/refunds; USD only; no automatic insurer reminders or deadlines; no term-to-claim attribution; wellness tracking is organizational and explicitly not insurance. No production deployment or remote migration is part of this phase.

## Future readiness

Future contracted carrier integrations can add separate verified identities and immutable source versions while retaining owner history. They require a new trust, authorization and legal/product review; no adapter is implemented now.

Phase 9C can reference stable pet/plan/claim/document identities and separately recorded submitted/reimbursed amounts. Actual expense, insurer reimbursement and future estimates must remain distinct. This phase implements no cost forecasting, budgets or medical-to-insurance eligibility logic.

## Local validation results

`npm run lint`, `npm run typecheck` and `npm run build` passed. Full `npm test`: 322 tests, 319 passed, 3 existing hosted-integration skips, zero failures. Sixteen new insurance tests/subtests cover the scenarios above. The Phase 7C policy snapshot still asserts every original policy unchanged and now separately permits exactly the six new insurance-bucket policies. Mobile fixture at 390 × 844 had no horizontal overflow or browser errors; every form control had a label. No hosted upload or remote database test was run.
