# Cost & Care Planning — Phase 9C

Pawport answers: what expenses have I recorded, what reimbursement have I explicitly allocated, and what amounts do I want to plan for? It does not advise what an owner can afford, what care should cost or what insurance will cover. There are no scraped prices, market averages, estimates, AI forecasts or affordability scores.

## Financial trust and authoritative records

Actual recorded expenses, insurance reimbursement allocations, owner-planned amounts and budgets are distinct database records and presentation groups. Every new expense and planned cost is `owner_entered`. Provider/carrier verification and `provider_quote` are reserved vocabulary with database checks prohibiting their creation in this phase. An attachment never verifies an amount. There is no Pawport estimate category or medical trust elevation.

The six new tables in `202609110019_cost_care_planning.sql` are `pet_expenses`, `expense_claim_allocations`, `pet_expense_events`, `pet_planned_costs`, `pet_cost_budgets` and `expense_documents`.

## Actual expenses

`pet_expenses` records title, category, service date, optional owner-entered provider name, cents, USD, notes and optional appointment/coverage-plan links. Identity (ID, household, pet, creator and creation time) cannot change. There is no normal deletion workflow. Amount means Recorded expense amount, not an insurer allowed amount or a calculated provider charge.

Categories: veterinary, emergency, dental, medication, pharmacy, grooming, boarding, daycare, walking, sitting, training, food, supplies, insurance_premium, wellness_plan and other. They are organizational labels only; nothing infers categories from medical text.

All individual amounts use nonnegative integer cents, capped at the Phase 9B technical limit of 9,000,000,000,000 cents. Expense currency is database-constrained USD. Summary sums use exact PostgreSQL numeric arithmetic; safe DTOs serialize cents as decimal integer strings so large totals never lose precision in JavaScript. Formatting uses BigInt, and decimal form amounts use exact integer conversion.

Appointment links require the same pet/household. Multiple expenses may link to one appointment. Coverage links require the same pet/household and mean organizational association, not covered treatment. Provider names remain free text, with no Google or provider identity matching. No expense creates a claim or modifies a medical record.

## Explicit reimbursement allocations

`expense_claim_allocations` has primary key `(expense_id, claim_id)`. The owner first selects the expense's coverage plan, then explicitly allocates a recorded claim reimbursement. Expense and claim must share creator, household, pet and coverage plan. Null claim reimbursement blocks allocation with instructions to record it in Insurance first.

Allocation totals cannot exceed either the expense amount or the claim's recorded reimbursement. Removing an allocation preserves an event. Claim amounts, status, approved amount, deductible, percent and owner-out-of-pocket fields are not copied or recalculated.

**Net recorded cost = recorded expense − explicitly allocated reimbursement.** It is nonnegative. It is not a determination of actual cost after all insurance, since records and allocations may be incomplete. Reimbursement is grouped by the linked expense's service year, not an inferred receipt date.

Expense edits cannot reduce an amount below allocations or change its coverage plan while incompatible allocations exist. A narrow trigger on the existing insurance claim rejects a reimbursement reduction/null value that would invalidate allocations. Owners adjust allocations first. The trigger never changes a 9B amount itself.

## Planning and explicit conversion

`pet_planned_costs` records an owner-selected planning year (2000–2200), optional amount and due date, title/category/notes, optional owned appointment/care-plan links and organizational status. Due dates must match the selected planning year. An unknown amount displays Amount not entered; undated items appear under Unscheduled. No guessed year, amount, recurring cost or medical schedule is created.

Statuses: planned, completed, cancelled and converted_to_expense. Completed is financial organization, not verified care. The owner's Record actual expense action requires entering an actual amount/date and checking confirmation. Conversion locks the plan, creates one new expense and stores `converted_expense_id`. Repeated conversion returns the same expense. Converted plans are immutable; expense corrections happen on the actual record. A planned amount is never silently committed as an actual amount.

## Budgets and factual arithmetic

`pet_cost_budgets` is unique per pet/year/category, including `all_care`. Category budgets need not add up to the overall budget. All amounts are owner entered, not recommended or adequate budgets.

For a selected year:

- Gross expenses: amounts grouped by service date.
- Allocated reimbursement: explicit allocations against those expenses.
- Net recorded cost: gross minus allocated.
- Owner-planned costs: nonnull amounts from status planned in that planning year, including undated plans; completed/cancelled/converted items are excluded.
- Remaining recorded budget: all-care budget minus net recorded cost.
- Unallocated after recorded + planned: budget minus net recorded cost minus owner-planned costs.

Negative remaining amounts are allowed and described as over your recorded budget, never You overspent or financial advice. Missing budget stays null, not zero. Category summaries contain only recorded expenses; no provider benchmarking, predictions or historical extrapolation exists.

## Read models, routes and navigation

`my_pet_cost_summary` and `my_cost_care_summary` normalize exact per-pet financial totals without policy/claim numbers. `my_pet_expenses` returns at most 50 safe items ordered by service date DESC, created_at DESC, ID DESC, with a complete three-part cursor. An extra row determines next-page availability. Year/category filtering is server-side. Planned costs use a separate bounded 100-item cursor page and grouped presentation. All reads authorize the authenticated owner.

Expense DTOs expose safe IDs, title/category/date/provider text, cents, allocations/net, document count and optional owned links. Detail adds private notes, safe claim IDs/titles/recorded statuses, documents and recent event names/dates, never claim/policy numbers or object paths. `my_cost_link_options` reads up to 100 recent appointments/routines and bounded coverage records for explicit selection; it returns no medical documents or inferred costs.

`/costs` is a per-pet dashboard. `/pets/[petId]/costs` has overview, expenses, planning, budget and insurance links. Expense/planning list, new and detail paths use one constrained owner-only route handler with exact segment/UUID checks. Expense detail supports editing, allocations, private documents and history. Planning detail supports owner completion/cancellation and explicit conversion. Budget controls edit total/category amounts.

Year defaults to the browser's local calendar year and remains explicitly switchable (2000–2200). Date-only service and due dates do not undergo timezone conversion. Account, Care, Insurance and the pet dashboard link to costs without adding a crowded mobile primary tab. Forms use visible labels, keyboard-native controls, error/status announcements and explicit conversion confirmation. All owner text uses escaped React rendering.

## Integration boundaries

Appointment detail has Add planned cost and Record expense links. Care-plan detail has Add to cost planning. These only open forms and preselect an owned link; they create nothing and infer no amount. No row is created when an appointment is booked or a routine occurs.

Insurance remains the source for claim status and reimbursement. Costs only records allocation choices. Preventive-care guidance never reads expenses/budget, changes priority because of insurance, or generates planned bills.

Timeline receives no financial events. Today remains unchanged, including the existing Phase 9B explicit renewal section; no 9C cards or budget notifications are added. Share Pass SQL/output remains unchanged and excludes expenses, budgets, reimbursements, plans and documents.

General business, veterinary-verification and scheduling membership confer no cost access. No financial data is sent to providers, ezyVet, Smart Openings, reviews, Local Services or public profiles. A dual-role user may access only their own pet finances through ordinary owner authorization.

## Documents and storage

`expense_documents` is separate from insurance and health documents. Types: receipt, invoice, estimate, statement, other. PDF/JPEG/PNG, 10 MiB maximum. No OCR, PDF parsing, amount extraction or verification occurs; even an attached estimate changes no expense amount.

The private `expense-documents` bucket uses generated `expenses/{household}/{pet}/{uuid}` paths. Preparation authorizes the expense owner, validates filename/MIME/size, expires old pending uploads and enforces limits. The Next.js upload proxy checks origin, authenticates the owner, bounds streamed bodies and checks file signatures. It uploads with the owner's Supabase session; no service-role key is introduced.

Finalization locks the expense/document, verifies storage object's expected MIME and size, and is idempotent. Download resolves the owner-only document through an internal transport RPC and proxies bytes with private/no-store, no-referrer, nosniff, forced attachment and sandbox CSP. Normal page/JSON DTOs expose IDs and safe metadata, not object keys or public signed URLs. Internal owner-authorized prepare/delivery helpers resolve only the owner's generated path, as in Phase 9B; knowing a path never grants access.

RLS permits owner-pending inserts and owner-ready reads only. Restrictive guards preserve separation from other buckets and forbid browser overwrite/delete. The boolean storage predicate is executable anonymously to preserve public reads in other buckets but returns false for anonymous insurance/expense access. Retired documents leave normal lists/delivery; physical cleanup is future work. Format signatures are checked, not malware-scanned or interpreted.

## Authorization, events and concurrency

All six new tables enable RLS and revoke direct PUBLIC/anon/authenticated access. Narrow SECURITY DEFINER RPCs use an empty search path and derive identity from auth.uid, pet and household. Private helpers are not browser executable except the non-disclosing storage predicate. Identity and link-integrity triggers are additional defenses.

`pet_expense_events` is append-only: expense_created/updated, claim_linked/unlinked, document_attached/removed. It stores no redundant amounts or sensitive payloads. Detail exposes the most recent 100 events.

Cost mutations acquire a per-pet transaction advisory lock, then entity row locks. Allocation locks the expense and claim and rechecks both sums. Conversion is serialized and uniquely linked. Budget upsert is protected by both locking and unique pet/year/category. Claim reimbursement updates participate through an integrity trigger; a competing insurance/cost transaction can be aborted by PostgreSQL deadlock detection rather than commit an inconsistent allocation. The client receives a safe failure and may retry after checking the saved state. Document preparation uses an owner upload-quota lock and parent lock; finalization/retirement lock the parent/document.

Write limits: 1,000 expenses/pet/service-year, 200 plans/pet/planning-year, one budget per category/year, 100 nonretired documents/expense and 50 preparations/owner/day. Pending uploads expire after one hour. Text and date bounds are database enforced. Expense/service dates are limited to 2000–2200. Indexes target pet/date cursor reads, pet/planning-year, claim allocation totals, expense events/documents and uniqueness. There are no speculative market-data indexes.

## Tests and validation approach

Local embedded PostgreSQL tests apply the full migration chain and exercise owner/foreign/anonymous/business/verifier access, identity, amount/category/link validation, explicit allocation caps, insurance-reduction guards, net arithmetic, planning conversion, budgets, equal-timestamp pagination, document lifecycle and Share Pass/medical separation. Concurrent promises exercise repeat/competing operations in the embedded harness; they are not a substitute for hosted multi-session stress tests.

UI tests check exact large-cent formatting, neutral negative-budget wording, distinct financial groups, unknown amounts, escaped text and private download boundaries. Browser fixtures use real components with synthetic data for mobile and keyboard checks. No real owner financial data or remote migrations are used. Existing regression checks remain intact; the policy snapshot permits exactly the new expense-bucket policies while continuing to compare every previous policy unchanged.

## Known limitations and Phase 9D readiness

Owner-entered expenses only; USD only; no bank/card integration, provider billing feed, automatic appointment price, provider price catalog, market prices, prediction/AI forecasting, provider comparison, coverage determination, automatic claim creation, receipt OCR/extraction, tax/accounting/financial advice or payments. Reimbursements require explicit allocation. No provider notification, receipt sharing, financial timeline, budget alerts or cost forecasting exists. Hosted authenticated upload and concurrent multi-session verification require a separate disposable staging environment.

Phase 9D may introduce contracted provider quotes and carrier/partner identities. A provider quote must have its own authorized source/version and remain distinct from an owner's planned amount or actual expense. The reserved source vocabulary and stable pet/expense/plan/claim IDs support such an additive design; no partnership, offer, pricing feed or quote integration is implemented here.

## Local validation results

Lint, typecheck and production build passed. Full regression: **336 tests, 333 passed, 3 existing hosted-integration skips, zero failures**. Fourteen new cost tests/subtests cover the scenarios above. Existing insurance, scheduling, medical, provider, review and storage tests remain enabled. The mobile component fixture passed at 390 × 844 with no horizontal overflow or browser errors; every form control had a label, conversion amount started blank and confirmation was required. The temporary fixture was removed before the build. No remote migration, deployment or production enablement occurred.
