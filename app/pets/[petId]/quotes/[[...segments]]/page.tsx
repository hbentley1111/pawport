import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownedPet } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { ecosystemRpc } from "@/lib/ecosystem/data";
import type { QuoteRequest } from "@/lib/ecosystem/schema";
import { QuoteCard } from "@/components/ecosystem/presentation";
import { EcosystemForm, QuotePlanning } from "@/components/ecosystem/forms";
import { RequestCTA } from "@/components/appointment-requests/presentation";
import { requestIntake } from "@/lib/appointment-requests/data";
import { LiveBookingLink } from "@/components/live-booking/owner";
import { selectedYear } from "@/lib/costs/data";
export const dynamic = "force-dynamic";
export default async function PetQuotes({
  params,
}: {
  params: Promise<{ petId: string; segments?: string[] }>;
}) {
  const { petId, segments: s = [] } = await params;
  if (s.length > 1 || (s[0] && !z.uuid().safeParse(s[0]).success)) notFound();
  const { db, pet } = await ownedPet(petId);
  const rows = await ecosystemRpc<QuoteRequest[]>(
    db,
    "my_service_quote_requests",
    { p_pet: petId, p_request: s[0] || null },
  );
  const r = s[0] ? rows[0] : null;
  const intake = r ? await requestIntake(r.locationId) : null;
  const year = await selectedYear(undefined);
  return (
    <AppFrame>
      <main className="care-page">
        <Link href="/quotes">All quote requests</Link>
        <h1>{pet.name}’s provider quotes</h1>
        {r ? (
          <>
            <h2>
              {r.businessName} — {r.serviceName}
            </h2>
            <p>
              {r.status} · Requested {r.requestedAt.slice(0, 10)}
            </p>
            <p>Your shared note: {r.ownerNote || "None"}</p>
            {r.currentQuote && <QuoteCard quote={r.currentQuote} />}
            <p>A quote creates no expense, appointment or insurance claim.</p>
            {r.status === "quoted" && r.currentQuote?.status === "sent" && (
              <>
                <QuotePlanning
                  petId={petId}
                  requestId={r.requestId}
                  year={year}
                />
                <details>
                  <summary>
                    Provider has updated this quote? Update an existing planning
                    reference explicitly
                  </summary>
                  <QuotePlanning
                    petId={petId}
                    requestId={r.requestId}
                    year={year}
                    update
                  />
                </details>
              </>
            )}
            {["requested", "quoted"].includes(r.status) && (
              <EcosystemForm
                action="withdraw"
                hidden={{ pet: petId, request: r.requestId }}
                label="Withdraw quote request"
              />
            )}
            <LiveBookingLink locationId={r.locationId} />
            {intake && <RequestCTA location={r.locationId} />}
            <details>
              <summary>Quote revision history</summary>
              {r.history.map((v) => (
                <QuoteCard key={v.revision} quote={v} />
              ))}
            </details>
          </>
        ) : (
          <>
            {rows.map((x) => (
              <p key={x.requestId}>
                <Link href={`/pets/${petId}/quotes/${x.requestId}`}>
                  {x.businessName} — {x.serviceName} · {x.status}
                </Link>
              </p>
            ))}
            {!rows.length && <p>No quote requests for this pet.</p>}
          </>
        )}
      </main>
    </AppFrame>
  );
}
