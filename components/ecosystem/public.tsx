import { createClient, configured } from "@/lib/supabase/server";
import type { Ecosystem } from "@/lib/ecosystem/schema";
import { QuoteLink, BusinessResponse } from "./presentation";
export async function PublicEcosystem({
  locationId,
  showReviews = false,
}: {
  locationId: string;
  showReviews?: boolean;
}) {
  if (!configured()) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("public_business_ecosystem", {
    p_location: locationId,
  });
  if (error || !data) return null;
  const d = data as Ecosystem;
  if (!showReviews && !d.services.length && !d.offers.length) return null;
  return (
    <section className="business-panel">
      <h2>From this claimed business</h2>
      {d.services.map((s) => (
        <article className="routine-card" key={s.id}>
          <h3>{s.name}</h3>
          <QuoteLink locationId={locationId} serviceId={s.id} />
        </article>
      ))}
      {d.offers.length > 0 && (
        <section>
          <h3>Business offers</h3>
          {d.offers.map((o) => (
            <article className="routine-card" key={o.offerId}>
              <h4>{o.title}</h4>
              <p>{o.sourceLabel}</p>
              <p>{o.valueText}</p>
              <p>{o.description}</p>
              {o.endsOn && <p>Valid through {o.endsOn}</p>}
              <details>
                <summary>View terms</summary>
                <p>{o.terms || "Contact the business for terms."}</p>
              </details>
            </article>
          ))}
        </section>
      )}
      {showReviews && (
        <section>
          <h3>Pawport community reviews</h3>
          {d.reviews.reviews.map((r) => (
            <article className="routine-card" key={r.id}>
              <h4>Pawport Member</h4>
              <p>{r.rating} of 5 stars</p>
              <p>{r.comment}</p>
              {r.response && <BusinessResponse response={r.response} />}
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
