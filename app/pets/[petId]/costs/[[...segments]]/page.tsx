import { QuoteCard } from "@/components/ecosystem/presentation";
import { EcosystemForm, QuotePlanning } from "@/components/ecosystem/forms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppFrame } from "@/components/app-frame";
import { ownedPet } from "@/lib/pet-data";
import { costRpc, selectedYear } from "@/lib/costs/data";
import {
  categories,
  dollars,
  type Summary,
  type Options,
  type ExpensePage,
  type ExpenseDetail,
  type Planned,
  type PlannedPage,
} from "@/lib/costs/schema";
import {
  CostNotice,
  CostSnapshot,
  ExpenseCard,
  PlannedList,
} from "@/components/costs/presentation";
import {
  YearPicker,
  CostForm,
  CostButton,
  ExpenseDocuments,
} from "@/components/costs/forms";
export const dynamic = "force-dynamic";
export default async function PetCosts({
  params,
  searchParams,
}: {
  params: Promise<{ petId: string; segments?: string[] }>;
  searchParams: Promise<{
    year?: string;
    category?: string;
    before?: string;
    created?: string;
    id?: string;
    appointment?: string;
    carePlan?: string;
  }>;
}) {
  const { petId, segments: s = [] } = await params,
    q = await searchParams;
  const { pet, db } = await ownedPet(petId),
    year = await selectedYear(q.year),
    base = `/pets/${petId}/costs`;
  if (
    s.length > 2 ||
    (s.length && !["expenses", "planning", "budget"].includes(s[0])) ||
    (s[0] === "budget" && s.length > 1) ||
    (s[1] && s[1] !== "new" && !z.uuid().safeParse(s[1]).success)
  )
    notFound();
  let content: React.ReactNode;
  if (!s.length || s[0] === "budget") {
    const summary = await costRpc<Summary>(db, "my_pet_cost_summary", {
      p_pet: petId,
      p_year: year,
    });
    content =
      s[0] === "budget" ? (
        <>
          <h1>Budget you entered</h1>
          <CostForm mode="budget" petId={petId} year={year} />
          {summary.categoryBudgets.map((b) => (
            <article className="routine-card" key={b.category}>
              <h2>{b.category.replaceAll("_", " ")}</h2>
              <CostForm
                mode="budget"
                petId={petId}
                year={year}
                initial={{
                  category: b.category,
                  amount: b.amountCents,
                  notes: b.notes,
                }}
              />
            </article>
          ))}
          <CostSnapshot data={summary} />
        </>
      ) : (
        <>
          <h1>{pet.name}’s costs</h1>
          <CostSnapshot data={summary} />
          <h2>Recorded expenses by category</h2>
          {summary.categoryExpenses.map((c) => (
            <p key={c.category}>
              {c.category.replaceAll("_", " ")}: {dollars(c.amountCents)}
            </p>
          ))}
        </>
      );
  } else if (s[0] === "expenses" && !s[1]) {
    if (
      q.category &&
      !categories.includes(q.category as (typeof categories)[number])
    )
      notFound();
    const page = await costRpc<ExpensePage>(db, "my_pet_expenses", {
      p_pet: petId,
      p_year: year,
      p_category: q.category || null,
      p_before: q.before || null,
      p_before_created: q.created || null,
      p_before_id: q.id || null,
    });
    content = (
      <>
        <h1>Recorded expenses</h1>
        <form className="business-form">
          <input type="hidden" name="year" value={year} />
          <label>
            Category
            <select name="category" defaultValue={q.category || ""}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="button secondary">Filter expenses</button>
        </form>
        <Link href={`${base}/expenses/new?year=${year}`}>Record expense</Link>
        {page.items.map((e) => (
          <ExpenseCard key={e.expenseId} expense={e} base={base} />
        ))}
        {!page.items.length && (
          <p>No recorded expenses match this year and category.</p>
        )}
        {page.nextCursor && (
          <Link
            href={`${base}/expenses?${new URLSearchParams({ year: String(year), category: q.category || "", before: page.nextCursor.date, created: page.nextCursor.created, id: page.nextCursor.id })}`}
          >
            Load more expenses
          </Link>
        )}
      </>
    );
  } else if (s[0] === "planning" && !s[1]) {
    const page = await costRpc<PlannedPage>(db, "my_pet_planned_costs", {
      p_pet: petId,
      p_year: year,
      p_before: q.id || null,
    });
    content = (
      <>
        <h1>Owner-planned costs</h1>
        <Link href={`${base}/planning/new?year=${year}`}>Add planned cost</Link>
        <PlannedList items={page.items} base={base} />
        {page.nextCursor && (
          <Link href={`${base}/planning?year=${year}&id=${page.nextCursor}`}>
            Load more plans
          </Link>
        )}
      </>
    );
  } else {
    const options = await costRpc<Options>(db, "my_cost_link_options", {
      p_pet: petId,
    });
    if (s[1] === "new") {
      const mode = s[0] === "expenses" ? "expense" : "planned";
      content = (
        <>
          <h1>{mode === "expense" ? "Record expense" : "Add planned cost"}</h1>
          <CostForm
            mode={mode}
            petId={petId}
            year={year}
            options={options}
            initial={{
              appointment_id: options.appointments.some(
                (a) => a.id === q.appointment,
              )
                ? q.appointment
                : null,
              care_plan_id: options.carePlans.some((a) => a.id === q.carePlan)
                ? q.carePlan
                : null,
            }}
          />
        </>
      );
    } else if (s[0] === "expenses") {
      const d = await costRpc<ExpenseDetail>(db, "my_pet_expense", {
          p_pet: petId,
          p_expense: s[1],
        }),
        e = d.expense;
      content = (
        <>
          <h1>{e.title}</h1>
          <ExpenseCard expense={e} base={base} />
          <CostForm
            mode="expense"
            petId={petId}
            id={e.expenseId}
            year={year}
            options={options}
            initial={{
              title: e.title,
              category: e.category,
              service_date: e.serviceDate,
              provider_name: e.providerName,
              amount_cents: e.amountCents,
              appointment_id: e.appointmentId,
              coverage_plan_id: e.coveragePlanId,
              notes: d.notes,
            }}
          />
          {e.appointmentId && (
            <Link href={`/appointments/${e.appointmentId}`}>
              Linked appointment
            </Link>
          )}
          {e.coveragePlanId && (
            <Link href={`/pets/${petId}/insurance/${e.coveragePlanId}`}>
              Linked coverage plan — not a coverage determination
            </Link>
          )}
          <section className="routine-summary">
            <h2>Insurance reimbursement allocations</h2>
            <p>
              Explicitly allocate money you recorded as received. Record the
              reimbursement on the insurance claim first. Allocating does not
              change claim amounts or determine coverage.
            </p>
            {!e.coveragePlanId && (
              <p>
                Select this expense’s coverage plan before allocating a claim.
              </p>
            )}
            {d.eligibleClaims.map((c) => {
              const allocation = d.allocations.find(
                (a) => a.claimId === c.claimId,
              );
              return (
                <article className="routine-card" key={c.claimId}>
                  <h3>
                    <Link
                      href={`/pets/${petId}/insurance/${e.coveragePlanId}/claims/${c.claimId}`}
                    >
                      {c.title}
                    </Link>
                  </h3>
                  <p>Status you recorded: {c.status.replaceAll("_", " ")}</p>
                  <p>
                    Recorded reimbursement:{" "}
                    {dollars(c.recordedReimbursementCents)} · Not yet allocated:{" "}
                    {dollars(c.unallocatedCents)}
                  </p>
                  {c.recordedReimbursementCents !== null ? (
                    <CostForm
                      mode="allocate"
                      petId={petId}
                      id={e.expenseId}
                      year={year}
                      initial={{
                        claim: c.claimId,
                        amount: allocation?.allocatedCents,
                      }}
                    />
                  ) : (
                    <p>
                      Record the reimbursement on the insurance claim first.
                    </p>
                  )}
                  {allocation && (
                    <>
                      <p>
                        Allocated here: {dollars(allocation.allocatedCents)}
                      </p>
                      <CostButton
                        petId={petId}
                        id={e.expenseId}
                        action="unlink"
                        claim={c.claimId}
                      >
                        Remove allocation
                      </CostButton>
                    </>
                  )}
                </article>
              );
            })}
          </section>
          <ExpenseDocuments
            petId={petId}
            expenseId={e.expenseId}
            documents={d.documents}
          />
          <h2>Recorded history</h2>
          {d.events.map((event, i) => (
            <p key={i}>
              {event.date.slice(0, 10)} · {event.type.replaceAll("_", " ")}
            </p>
          ))}
        </>
      );
    } else {
      const p = await costRpc<Planned>(db, "my_pet_planned_cost", {
        p_pet: petId,
        p_planned: s[1],
      });
      content = (
        <>
          <h1>{p.title}</h1>
          <p>
            {p.source === "provider_quote"
              ? "Provider quote planning"
              : "Owner planned"}
            : {dollars(p.plannedAmountCents)} · {p.status.replaceAll("_", " ")}
          </p>
          {p.quote && (
            <>
              <p>{p.businessName}</p>
              <QuoteCard quote={p.quote} />
              {p.quoteUpdated && p.quoteRequestId && (
                <>
                  <p>
                    Provider has updated this quote. Your saved planning record
                    has not changed.
                  </p>
                  <QuotePlanning
                    petId={petId}
                    requestId={p.quoteRequestId}
                    year={p.planningYear}
                    update
                  />
                </>
              )}
            </>
          )}
          {p.convertedExpenseId ? (
            <Link href={`${base}/expenses/${p.convertedExpenseId}`}>
              View recorded expense
            </Link>
          ) : p.source === "provider_quote" ? (
            <EcosystemForm
              action="plan_status"
              hidden={{ pet: petId, planned: p.plannedCostId }}
              label="Update planning status"
              fields={[
                {
                  name: "status",
                  label: "Planning status (not medical completion)",
                  options: ["planned", "completed", "cancelled"].map((id) => ({
                    id,
                    name: id,
                  })),
                  value: p.status,
                },
              ]}
            />
          ) : (
            <CostForm
              mode="planned"
              petId={petId}
              id={p.plannedCostId}
              year={p.planningYear}
              options={options}
              initial={{
                title: p.title,
                category: p.category,
                planned_amount_cents: p.plannedAmountCents,
                planning_year: p.planningYear,
                due_on: p.dueOn,
                status: p.status,
                appointment_id: p.appointmentId,
                care_plan_id: p.carePlanId,
                notes: p.notes,
              }}
            />
          )}
          {p.status === "planned" && (
            <section>
              <h2>Record actual expense</h2>
              <p>
                Enter and confirm the actual amount. The planned amount will not
                be silently copied.
              </p>
              <CostForm
                mode="convert"
                petId={petId}
                id={p.plannedCostId}
                year={p.planningYear}
              />
            </section>
          )}
        </>
      );
    }
  }
  return (
    <AppFrame>
      <main className="care-page">
        <nav className="care-page-links" aria-label="Cost destinations">
          <Link href={`/pets/${petId}`}>{pet.name}</Link>
          {[
            ["", "Overview"],
            ["/expenses", "Expenses"],
            ["/planning", "Planning"],
            ["/budget", "Budget"],
          ].map(([path, label]) => (
            <Link key={path} href={`${base}${path}?year=${year}`}>
              {label}
            </Link>
          ))}
          <Link href={`/pets/${petId}/insurance`}>
            Insurance &amp; reimbursements
          </Link>
          <Link href="/costs">All pets</Link>
        </nav>
        <YearPicker key={year} year={year} explicit={!!q.year} />
        {content}
        <CostNotice />
      </main>
    </AppFrame>
  );
}
