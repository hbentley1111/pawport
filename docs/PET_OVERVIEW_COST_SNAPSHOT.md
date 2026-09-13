# Pet Overview Care Cost Snapshot

## Purpose and placement

The owner pet overview shows a compact care cost snapshot after the overview statistics and before vaccination records. It replaces the earlier plain costs link without changing passport, records or other pet workflows. The whole card opens that pet's costs page for the displayed year.

## UX rationale

A restrained bone-shaped horizontal visual uses PetThread's muted greens and neutrals. Spent, planned and expected amounts remain separate text values. This is an organizational summary, not a price prediction or financial recommendation.

## Data definitions

The server reuses the existing owner-authorized `my_pet_cost_summary(p_pet,p_year)` RPC and `selectedYear` default calendar-year convention from the costs area. No schema changes or financial writes are needed. The helper rejects a summary for another pet or year.

- Spent so far uses Phase 9C's **net recorded cost**: recorded expenses minus explicitly allocated insurance reimbursements. When reimbursements exist, the card labels this basis and separately states gross expenses and allocated reimbursements.
- Planned includes entered amounts on items whose status remains `planned`, filtered by the selected planning year. Completed, cancelled and converted items are excluded.
- Expected total is net recorded cost plus entered planned amounts.
- Budget is the existing pet/year `all_care` budget, not a sum of category budgets.
- Remaining budget is budget minus expected total, matching the costs area's unallocated-after-recorded-and-planned calculation.

Expenses use service-date year. Planned items use planning year, including unscheduled items. Null amounts and provider quote ranges add no assumed amount; no midpoint is invented. Arithmetic and currency formatting use integer cents/BigInt. Only normalized chart proportions use JavaScript numbers.

## Visual model

Solid green represents spent; hatching represents planned; neutral space represents positive remaining budget. Segment lengths use the larger of budget and expected total as the scale. Without a budget, the scale is expected total and no remaining label appears. The bone is illustrative; text amounts are authoritative.

## Empty states

Zero expenses and no open plans show an invitation to record expenses and plan care. Open plans without amounts retain the normal summary and explain that no price is assumed. A failed or invalid summary shows unavailable copy rather than misleading zero amounts. Spent-only and planned-only states retain all primary values.

## Budget behavior

A missing budget hides budget and remaining metrics. A recorded zero budget is still a budget. Negative remaining values are retained in the model and shown as an explicit amount over the recorded budget, without a negative chart segment or judgmental wording. Expected total includes planning, so an over-budget state does not claim that all of that money has been spent.

## Accessibility and verification

All major amounts appear in text. The SVG has an accessible label including spent, planned, expected total and remaining/over-budget amount. Hatching and text distinguish segments without relying on color. The single card link supports keyboard navigation and a visible focus outline; it contains no nested controls. Mobile stacks the visual and metrics.

Unit/render tests cover combinations of data, missing/zero/overrun budgets, exact cents, reimbursement basis, accessible labeling and destination links. A database test exercises the existing migrations and owner RPCs to verify pet/year isolation, foreign-owner rejection, converted/completed/cancelled exclusions and a real range-quote-to-planning workflow. Local component fixtures were visually checked at 390px, 768px and 1440px, then removed. This visual check does not substitute for a hosted authenticated end-to-end session.

Validation: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` passed. The full suite reported 379 tests: 376 passed, 3 existing hosted-environment skips, 0 failures. Thirteen tests were added for this enhancement. The local browser reported no errors and desktop verification confirmed a visible 3px focus outline.

## Known limitations

- Current-year snapshot only; no multi-year comparison. The default year follows the existing server calendar-year helper, not a new browser timezone preference.
- No reimbursement logic beyond existing explicit cost-model allocations.
- No chart customization or export.
- No forecasting, AI projection or inferred prices; unknown planned amounts are not included in expected total.
- No household-wide rollup on a pet page.
- No new Today, Timeline, provider, Share Pass or public financial access.
