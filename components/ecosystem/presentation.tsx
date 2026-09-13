import Link from "next/link";
import { type ResponseDTO } from "@/lib/ecosystem/schema";
import { ReportResponse } from "./forms";
export { QuoteCard } from "./quote-card";
export function BusinessResponse({ response: r }: { response: ResponseDTO }) {
  return (
    <section className="routine-card">
      <h4>Response from {r.businessName}</h4>
      <p>{r.sourceLabel}</p>
      <p>{r.body}</p>
      <ReportResponse id={r.responseId} />
    </section>
  );
}
export function QuoteLink({
  locationId,
  serviceId,
}: {
  locationId: string;
  serviceId?: string;
}) {
  return (
    <Link
      className="document-link"
      href={`/quotes?locationId=${locationId}${serviceId ? `&serviceId=${serviceId}` : ""}`}
    >
      Request quote
    </Link>
  );
}
