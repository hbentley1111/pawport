import {
  quoteAmount,
  quoteDisclaimer,
  type Quote,
} from "@/lib/ecosystem/schema";
export function QuoteCard({ quote: q }: { quote: Quote }) {
  return (
    <article className="routine-card">
      <h3>Provider quote · Revision {q.revision}</h3>
      <p aria-label={`Provider quote: ${quoteAmount(q)}`}>{quoteAmount(q)}</p>
      <p>This is a provider-entered estimate, not a guaranteed final price.</p>
      {q.validUntil && <p>Valid through {q.validUntil}</p>}
      {q.status === "expired" && (
        <p>
          Quote validity date has passed. Confirm current pricing with the
          business.
        </p>
      )}
      {q.status === "withdrawn" && <p>Quote withdrawn.</p>}
      {q.note && <p>{q.note}</p>}
      <p>{quoteDisclaimer}</p>
    </article>
  );
}
