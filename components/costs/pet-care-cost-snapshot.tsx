import { useId } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { dollars } from "@/lib/costs/schema";
import type { CareCostSnapshot } from "@/lib/costs/snapshot";
export function CostSnapshotBoneChart({ data: d }: { data: CareCostSnapshot }) {
  const id = useId().replaceAll(":", ""),
    clip = `bone-${id}`,
    pattern = `planned-${id}`;
  const label = `Care cost snapshot. Spent so far ${dollars(d.spent)}${d.reimbursed !== "0" ? " net recorded cost" : ""}. Planned ${dollars(d.planned)}. Expected total ${dollars(d.expected)}.${d.remaining !== null ? ` ${d.overBudget ? "Over recorded budget" : "Remaining budget"} ${dollars(d.overBudget ? String(-BigInt(d.remaining)) : d.remaining)}.` : ""}`;
  const path =
    "M70 30 C54 3 20 1 12 23 C5 40 17 46 17 50 C17 54 5 60 12 77 C20 99 54 97 70 70 H450 C466 97 500 99 508 77 C515 60 503 54 503 50 C503 46 515 40 508 23 C500 1 466 3 450 30 Z";
  return (
    <svg
      className="cost-bone"
      viewBox="0 0 520 100"
      role="img"
      aria-label={label}
    >
      <defs>
        <clipPath id={clip}>
          <path d={path} />
        </clipPath>
        <pattern
          id={pattern}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
        >
          <rect width="7" height="7" fill="#b8c8b7" />
          <path
            d="M-2 2L2 -2M0 7L7 0M5 9L9 5"
            stroke="#91aa96"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="520" height="100" fill="#ecede5" />
        <rect width={d.segments.spent * 5.2} height="100" fill="#335c4b" />
        <rect
          x={d.segments.spent * 5.2}
          width={d.segments.planned * 5.2}
          height="100"
          fill={`url(#${pattern})`}
        />
      </g>
      <path d={path} fill="none" stroke="#aabaac" strokeWidth="1.5" />
    </svg>
  );
}
export function PetCareCostSnapshot({
  petId,
  year,
  data,
}: {
  petId: string;
  year: number;
  data: CareCostSnapshot | null;
}) {
  return (
    <Link
      className="pet-cost-snapshot"
      href={`/pets/${petId}/costs?year=${year}`}
    >
      <header>
        <div>
          <p className="cost-snapshot-year">{year} · CARE & PLANNING</p>
          <h2>Care cost snapshot</h2>
          <p>See what care has cost — and what’s coming next.</p>
        </div>
        <ArrowUpRight size={21} aria-hidden="true" />
      </header>
      {data ? (
        <>
          {data.empty && (
            <div className="cost-snapshot-empty">
              <h3>No care costs recorded yet.</h3>
              <p>
                As you add expenses and plan upcoming care, you’ll see the
                picture here.
              </p>
            </div>
          )}
          <div className="cost-snapshot-content">
            <div>
              <CostSnapshotBoneChart data={data} />
              <ul className="cost-snapshot-legend" aria-label="Visual segments">
                <li>
                  <span className="cost-key spent" aria-hidden="true" />
                  Spent{data.reimbursed !== "0" ? " (net)" : ""}
                </li>
                <li>
                  <span className="cost-key planned" aria-hidden="true" />
                  Planned
                </li>
                {data.budget !== null && (
                  <li>
                    <span className="cost-key remaining" aria-hidden="true" />
                    {data.overBudget ? "No remaining budget" : "Remaining"}
                  </li>
                )}
              </ul>
            </div>
            <dl className="cost-snapshot-metrics">
              <div>
                <dt>
                  Spent so far
                  {data.reimbursed !== "0" && <small>Net recorded cost</small>}
                </dt>
                <dd>{dollars(data.spent)}</dd>
              </div>
              <div>
                <dt>Planned</dt>
                <dd>{dollars(data.planned)}</dd>
              </div>
              <div className="cost-snapshot-total">
                <dt>Expected total</dt>
                <dd>{dollars(data.expected)}</dd>
              </div>
              {data.budget !== null && (
                <>
                  <div>
                    <dt>Budget</dt>
                    <dd>{dollars(data.budget)}</dd>
                  </div>
                  <div className="cost-snapshot-budget">
                    <dt>
                      {data.overBudget
                        ? "Over recorded budget"
                        : "Remaining budget"}
                    </dt>
                    <dd>
                      {dollars(
                        data.overBudget
                          ? String(-BigInt(data.remaining!))
                          : data.remaining,
                      )}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <p className="cost-snapshot-note">
            {data.reimbursed !== "0"
              ? `Recorded expenses ${dollars(data.gross)} · Reimbursements allocated ${dollars(data.reimbursed)}. `
              : ""}
            Expected total combines net recorded cost and entered planned
            amounts; it is not a forecast.
            {data.hasOpenPlans &&
              " Plans without an entered amount, including quote ranges, add no assumed price."}
          </p>
        </>
      ) : (
        <p className="cost-snapshot-empty">
          Your cost snapshot is temporarily unavailable. Open costs &amp;
          planning to view your records.
        </p>
      )}
      <footer>
        <span>
          {data?.empty ? "Start planning care" : "View costs & planning"}
        </span>
        <span aria-hidden="true">→</span>
      </footer>
    </Link>
  );
}
