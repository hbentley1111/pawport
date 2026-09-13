import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { ecosystemRpc } from "@/lib/ecosystem/data";
import type { Ecosystem, QuoteRequest } from "@/lib/ecosystem/schema";
import { EcosystemForm } from "@/components/ecosystem/forms";
export const dynamic = "force-dynamic";
export default async function Quotes({
  searchParams,
}: {
  searchParams: Promise<{
    locationId?: string;
    serviceId?: string;
    before?: string;
    id?: string;
  }>;
}) {
  const q = await searchParams,
    { db } = await ownerSession();
  const requests = await ecosystemRpc<QuoteRequest[]>(
    db,
    "my_service_quote_requests",
    { p_before: q.before || null, p_before_id: q.id || null },
  );
  let intake: Ecosystem | null = null;
  let pets: { id: string; name: string }[] = [];
  if (q.locationId) {
    intake = await ecosystemRpc<Ecosystem | null>(
      db,
      "public_business_ecosystem",
      { p_location: q.locationId },
    );
    const { data } = await db.from("pets").select("id,name");
    pets = data || [];
  }
  return (
    <AppFrame>
      <main className="care-page">
        <h1>Provider quotes</h1>
        <p>
          Request price information from a claimed business. A quote is not a
          booking, guaranteed price or insurance decision.
        </p>
        {q.locationId &&
          (intake?.services.length && pets.length ? (
            <EcosystemForm
              action="request"
              hidden={{ location: q.locationId }}
              label="Request quote"
              warning="Your pet’s name, species, selected service and note will be shared with this business. Do not include sensitive medical information."
              fields={[
                { name: "pet", label: "Pet", options: pets },
                {
                  name: "service",
                  label: "Service",
                  options: intake.services,
                  value: intake.services.some((s) => s.id === q.serviceId)
                    ? q.serviceId
                    : undefined,
                },
                {
                  name: "owner_note",
                  label:
                    "Anything you’d like the business to know about this quote request",
                  type: "textarea",
                  max: 1000,
                },
              ]}
            />
          ) : (
            <p>
              Quote requests are unavailable here, or you need to add a pet
              first.
            </p>
          ))}
        {requests.map((r) => (
          <article className="routine-card" key={r.requestId}>
            <h2>
              <Link href={`/pets/${r.petId}/quotes/${r.requestId}`}>
                {r.petName} — {r.serviceName}
              </Link>
            </h2>
            <p>
              {r.businessName} · {r.status} · {r.requestedAt.slice(0, 10)}
            </p>
          </article>
        ))}
        {!requests.length && (
          <p>
            No quote requests yet. Request a quote from an eligible claimed
            business profile.
          </p>
        )}
        {requests.length === 50 && (
          <Link
            href={`/quotes?${new URLSearchParams({ before: requests[49].requestedAt, id: requests[49].requestId })}`}
          >
            More quote requests
          </Link>
        )}
        <Link href="/services">Local Services</Link>
        <Link href="/costs">Costs &amp; planning</Link>
      </main>
    </AppFrame>
  );
}
