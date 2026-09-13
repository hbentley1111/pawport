import { QuoteCard } from "@/components/ecosystem/quote-card";
import Link from "next/link";
import {
  dollars,
  notice,
  type Summary,
  type Expense,
  type Planned,
} from "@/lib/costs/schema";
export function CostNotice() {
  return <p className="routine-card">{notice}</p>;
}
export function CostSnapshot({ data: d }: { data: Summary }) {
  return (
    <section className="routine-summary">
      <h2>
        {d.petName} · {d.year}
      </h2>
      <div className="today-items">
        <article className="routine-card">
          <h3>Recorded expenses</h3>
          <p>{dollars(d.grossExpenses)}</p>
          <p>Owner entered</p>
        </article>
        <article className="routine-card">
          <h3>Insurance reimbursements allocated</h3>
          <p>{dollars(d.allocatedReimbursements)}</p>
          <p>Explicit owner allocations</p>
        </article>
        <article className="routine-card">
          <h3>Net recorded cost</h3>
          <p>{dollars(d.netRecordedCost)}</p>
        </article>
        <article className="routine-card">
          <h3>Owner-planned costs</h3>
          <p>{dollars(d.plannedUpcoming)}</p>
          <p>{d.openPlannedCount} open plans, including unscheduled plans</p>
        </article>
        <article className="routine-card">
          <h3>Budget you entered</h3>
          <p>{dollars(d.budgetAmount)}</p>
          {d.remainingRecordedBudget !== null && (
            <p>
              {BigInt(d.remainingRecordedBudget) < BigInt(0)
                ? `${dollars((-BigInt(d.remainingRecordedBudget)).toString())} over your recorded budget`
                : `Remaining recorded budget: ${dollars(d.remainingRecordedBudget)}`}
            </p>
          )}
          {d.unallocatedAfterRecordedAndPlanned !== null && (
            <p>
              Unallocated after recorded + planned:{" "}
              {dollars(d.unallocatedAfterRecordedAndPlanned)}
            </p>
          )}
        </article>
      </div>
      <Link href={`/pets/${d.petId}/costs?year=${d.year}`}>
        View {d.petName}’s costs
      </Link>
    </section>
  );
}
export function ExpenseCard({
  expense: e,
  base,
}: {
  expense: Expense;
  base: string;
}) {
  return (
    <article className="routine-card">
      <h3>
        <Link href={`${base}/expenses/${e.expenseId}`}>{e.title}</Link>
      </h3>
      <p>
        {e.serviceDate} · {e.category.replaceAll("_", " ")} · {e.providerName}
      </p>
      <p>Recorded expense: {dollars(e.amountCents)}</p>
      <p>Insurance allocated: {dollars(e.allocatedReimbursementCents)}</p>
      <p>Net recorded cost: {dollars(e.netRecordedCostCents)}</p>
      <p>Owner entered · {e.documentCount} documents attached</p>
    </article>
  );
}
export function PlannedList({
  items,
  base,
}: {
  items: Planned[];
  base: string;
}) {
  return (
    <>
      {["Upcoming", "Unscheduled", "Completed", "Cancelled"].map((group) => (
        <section className="routine-summary" key={group}>
          <h2>{group}</h2>
          {items
            .filter((p) =>
              p.status === "planned"
                ? (p.dueOn ? "Upcoming" : "Unscheduled") === group
                : p.status === "cancelled"
                  ? group === "Cancelled"
                  : group === "Completed",
            )
            .sort(
              (a, b) =>
                (a.dueOn || "").localeCompare(b.dueOn || "") ||
                a.plannedCostId.localeCompare(b.plannedCostId),
            )
            .map((p) => (
              <article key={p.plannedCostId} className="routine-card">
                <h3>
                  <Link href={`${base}/planning/${p.plannedCostId}`}>
                    {p.title}
                  </Link>
                </h3>
                <p>
                  {p.dueOn || "No date entered"} · {p.planningYear}
                </p>
                <p>Planned amount: {dollars(p.plannedAmountCents)}</p>
                {p.quote && (
                  <>
                    <p>{p.businessName}</p>
                    <QuoteCard quote={p.quote} />
                    {p.quoteUpdated && (
                      <p>
                        Provider has updated this quote. Your saved planning
                        amount has not changed.
                      </p>
                    )}
                  </>
                )}
                <p>
                  {p.source === "provider_quote"
                    ? "Provider quote"
                    : "Owner entered"}{" "}
                  · {p.status.replaceAll("_", " ")}
                </p>
              </article>
            ))}
        </section>
      ))}
      {!items.length && <p>No planned costs entered for this year.</p>}
    </>
  );
}
