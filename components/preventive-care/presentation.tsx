import Link from "next/link";
import {
  guidanceDisclaimer,
  itemDate,
  type PreventiveCare,
  type PreventiveItem,
  type PreventiveSummary,
  type Guidance,
} from "@/lib/preventive-care/schema";
export function SourceBadge({
  item,
}: {
  item: Pick<PreventiveItem, "sourceType" | "sourceLabel">;
}) {
  return (
    <span
      className={`preventive-source ${item.sourceType === "pawport_guidance" ? "guidance-source" : ""}`}
    >
      {item.sourceLabel}
    </span>
  );
}
export function PreventiveSummaryCard({
  summary,
}: {
  summary: PreventiveSummary;
}) {
  return (
    <article className="routine-card">
      <h3>{summary.petName}</h3>
      <p>
        {summary.attentionCount} record{summary.attentionCount === 1 ? "" : "s"}{" "}
        needing attention · {summary.upcomingCount} upcoming ·{" "}
        {summary.guidanceCount} discussion topic
        {summary.guidanceCount === 1 ? "" : "s"}
      </p>
      <Link className="document-link" href={`/pets/${summary.petId}/care`}>
        View {summary.petName}’s care
      </Link>
    </article>
  );
}
export function GuidanceCard({ item }: { item: Guidance }) {
  return (
    <article className="routine-card">
      <SourceBadge item={item} />
      <h3>{item.title}</h3>
      <p>{item.summary}</p>
      <Link className="document-link" href={item.actionUrl}>
        Things to ask your veterinarian
      </Link>
    </article>
  );
}
function ItemCard({ item }: { item: PreventiveItem }) {
  return (
    <article className="routine-card">
      <SourceBadge item={item} />
      <h3>{item.title}</h3>
      <p>
        {item.itemType === "record" && item.date
          ? "Record " +
            (item.status === "expired" ? "expired" : "expires") +
            ": "
          : item.itemType === "routine"
            ? "Your schedule: "
            : ""}
        {itemDate(item)}
      </p>
      <p className="fine-print">{item.explanation}</p>
      <Link className="document-link" href={item.actionUrl}>
        {item.itemType === "record"
          ? "View health records"
          : item.itemType === "routine"
            ? "View care plan"
            : "View appointment"}
      </Link>
    </article>
  );
}
export function PreventiveSnapshot({ data }: { data: PreventiveCare }) {
  const supported = ["dog", "cat"].includes(
    data.pet.species?.trim().toLowerCase() || "",
  );
  return (
    <>
      <section className="routine-summary">
        <h2>Needs attention</h2>
        <p className="fine-print">
          Stored record dates only. These are not treatment recommendations.
        </p>
        {data.needsAttention.length ? (
          data.needsAttention.map((i) => <ItemCard key={i.id} item={i} />)
        ) : (
          <p>No record-based items need attention right now.</p>
        )}
      </section>
      <section className="routine-summary">
        <h2>Coming up</h2>
        <p className="fine-print">The next 90 days</p>
        {data.upcoming.length ? (
          data.upcoming.map((i) => <ItemCard key={i.id} item={i} />)
        ) : (
          <p>No dated care is recorded in this window.</p>
        )}
      </section>
      <section className="routine-summary">
        <h2>Your routines</h2>
        {data.routines.length ? (
          data.routines.map((i) => <ItemCard key={i.id} item={i} />)
        ) : (
          <p>No active care routines yet.</p>
        )}
        <Link href="/care/plans/new" className="document-link">
          Create a care plan
        </Link>
      </section>
      {!!data.records.length && (
        <section className="routine-summary">
          <h2>Other vaccination records</h2>
          {data.records.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
        </section>
      )}
      <section className="routine-summary">
        <h2>Things to discuss with your veterinarian</h2>
        <p>{guidanceDisclaimer}</p>
        {!supported && (
          <p>
            Pawport doesn’t yet provide general preventive-care guidance for
            this species. Your records, appointments and care plans are still
            available.
          </p>
        )}
        {data.guidance.length ? (
          data.guidance.map((i) => <GuidanceCard item={i} key={i.id} />)
        ) : (
          <p>
            No general preventive-care topics are currently available for this
            pet.
          </p>
        )}
      </section>
      {!!data.savedGuidance.filter(
        (i) => !data.guidance.some((g) => g.id === i.id),
      ).length && (
        <details className="routine-card">
          <summary>Saved discussion preferences</summary>
          {data.savedGuidance
            .filter((i) => !data.guidance.some((g) => g.id === i.id))
            .map((i) => (
              <p key={i.id}>
                <Link href={i.actionUrl}>{i.title}</Link> ·{" "}
                {i.status === "discussed"
                  ? "Marked discussed by you"
                  : i.status === "not_relevant"
                    ? "Not relevant"
                    : `Hidden until ${i.snoozedUntil}`}
              </p>
            ))}
        </details>
      )}
    </>
  );
}
