import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { QuoteCard } from "../components/ecosystem/quote-card";
import { PlannedList } from "../components/costs/presentation";
import { quoteAmount, type Quote } from "../lib/ecosystem/schema";
const quote: Quote = {
  quoteId: "q",
  revision: 1,
  amountType: "range",
  amountCents: null,
  minimumAmountCents: "65000",
  maximumAmountCents: "90000",
  validUntil: "2026-09-30",
  note: "<script>private()</script>",
  status: "sent",
  sourceLabel: "Provider quote",
};
test("Accessible provider range keeps both endpoints and escaped plain text", () => {
  const html = renderToStaticMarkup(createElement(QuoteCard, { quote }));
  assert.match(html, /aria-label="Provider quote: \$650.00 to \$900.00"/);
  assert.match(html, /not a guaranteed final price/);
  assert.match(html, /Confirm final pricing with the provider/);
  assert.doesNotMatch(html, /<script>|\$775|verified price/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(
    quoteAmount({ ...quote, amountType: "contact_for_price" }),
    "Contact for price",
  );
});
test("Saved quote planning keeps provider provenance and explicit update notice", () => {
  const html = renderToStaticMarkup(
    createElement(PlannedList, {
      base: "/costs",
      items: [
        {
          plannedCostId: "p",
          title: "Dental cleaning",
          category: "dental",
          plannedAmountCents: null,
          planningYear: 2026,
          dueOn: null,
          status: "planned",
          appointmentId: null,
          carePlanId: null,
          convertedExpenseId: null,
          notes: null,
          source: "provider_quote",
          quote,
          quoteUpdated: true,
          businessName: "Business",
        },
      ],
    }),
  );
  assert.match(html, /Provider quote/);
  assert.match(html, /updated this quote/);
  assert.doesNotMatch(html, /\$775|owner-entered estimate/);
});
test("Publication, request and provider controls retain privacy copy and explicit consent", async () => {
  const forms = await readFile("components/ecosystem/forms.tsx", "utf8");
  assert.match(forms, /confirm/);
  assert.match(forms, /type: "checkbox"|type:'checkbox'/);
  const management = await readFile(
    "app/provider/businesses/[organizationId]/community/page.tsx",
    "utf8",
  );
  assert.match(management, /Do not include customer names/);
  assert.match(management, /canManage/);
  const request = await readFile("app/quotes/page.tsx", "utf8");
  assert.match(request, /Do not include sensitive medical information/);
});
test("New public and provider modules have no medical, financial or vendor-data reads", async () => {
  const files = [
    "components/ecosystem/public.tsx",
    "app/provider/businesses/[organizationId]/community/page.tsx",
    "app/provider/businesses/[organizationId]/quotes/[[...segments]]/page.tsx",
  ];
  for (const file of files) {
    const s = await readFile(file, "utf8");
    assert.doesNotMatch(
      s,
      /health_documents|insurance_claims|pet_expenses|pet_cost_budgets|credential_ref|external_pet_id|dangerouslySetInnerHTML/,
    );
  }
  const sql = await readFile(
    "supabase/migrations/202609110020_partnerships_expanded_community.sql",
    "utf8",
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public.read_share_pass|update public.service_reviews|insert into public.veterinary_providers|insert into public.provider_memberships|insert into public.appointments|insert into public.pet_expenses/,
  );
});
