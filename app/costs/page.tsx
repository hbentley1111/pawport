import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { ownerSession } from "@/lib/pet-data";
import { costRpc, selectedYear } from "@/lib/costs/data";
import type { Summary } from "@/lib/costs/schema";
import { CostSnapshot, CostNotice } from "@/components/costs/presentation";
import { YearPicker } from "@/components/costs/forms";
export const dynamic = "force-dynamic";
export default async function Costs({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const q = await searchParams,
    year = await selectedYear(q.year),
    { db } = await ownerSession();
  const pets = await costRpc<Summary[]>(db, "my_cost_care_summary", {
    p_year: year,
  });
  return (
    <AppFrame>
      <main className="care-page">
        <h1>Costs &amp; planning</h1>
        <YearPicker year={year} explicit={!!q.year} />
        <CostNotice />
        {!pets.length && <p>Add a pet to organize costs.</p>}
        {pets.map((p) => (
          <CostSnapshot key={p.petId} data={p} />
        ))}
        <Link href="/quotes">Provider quotes</Link>
        <Link href="/insurance">Insurance &amp; coverage</Link>
      </main>
    </AppFrame>
  );
}
