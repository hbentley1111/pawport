import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { ServicesShell } from "@/components/services/shell";
import { ecosystemRpc } from "@/lib/ecosystem/data";
import type { QuoteRequest, Management } from "@/lib/ecosystem/schema";
import { QuoteCard } from "@/components/ecosystem/presentation";
import { EcosystemForm, QuoteSend } from "@/components/ecosystem/forms";
export const dynamic = "force-dynamic";
export default async function Inbox({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; segments?: string[] }>;
  searchParams: Promise<{ before?: string; id?: string }>;
}) {
  const { organizationId: org, segments: s = [] } = await params,
    q = await searchParams;
  if (
    !z.uuid().safeParse(org).success ||
    s.length > 1 ||
    (s[0] && !z.uuid().safeParse(s[0]).success)
  )
    notFound();
  const { db } = await ownerSession();
  const [m, rows] = await Promise.all([
    ecosystemRpc<Management>(db, "my_business_ecosystem", { p_org: org }),
    ecosystemRpc<QuoteRequest[]>(db, "service_provider_quote_requests", {
      p_org: org,
      p_request: s[0] || null,
      p_before: q.before || null,
      p_before_id: q.id || null,
    }),
  ]);
  return (
    <ServicesShell>
      <main className="care-page">
        <Link href="/provider/dashboard">Business dashboard</Link>
        <Link href={`/provider/businesses/${org}/community`}>
          Quote settings, offers &amp; reviews
        </Link>
        <h1>Quote requests</h1>
        <p>
          {m.newQuoteRequests} new · {m.sentQuotes} sent · Accessible locations
          only
        </p>
        {rows.map((r) => (
          <article className="business-panel" key={r.requestId}>
            <h2>
              <Link href={`/provider/businesses/${org}/quotes/${r.requestId}`}>
                {r.pet?.name} — {r.serviceName}
              </Link>
            </h2>
            <p>
              {r.locationName} · {r.pet?.species} · {r.status}
            </p>
            <p>Requested {r.requestedAt.slice(0, 10)}</p>
            {s[0] && (
              <>
                <p>Owner-shared note: {r.ownerNote || "None"}</p>
                {r.currentQuote && <QuoteCard quote={r.currentQuote} />}
                <p>No other pet, medical or financial records are shared.</p>
                {m.canManage && ["requested", "quoted"].includes(r.status) && (
                  <>
                    <QuoteSend org={org} request={r.requestId} />
                    <EcosystemForm
                      action="declined"
                      hidden={{ org, request: r.requestId }}
                      label="Decline quote request"
                    />
                    {r.currentQuote && (
                      <EcosystemForm
                        action="withdrawn"
                        hidden={{ org, request: r.requestId }}
                        label="Withdraw quote"
                      />
                    )}
                  </>
                )}
                <details>
                  <summary>Revision history</summary>
                  {r.history.map((v) => (
                    <QuoteCard key={v.revision} quote={v} />
                  ))}
                </details>
              </>
            )}
          </article>
        ))}
        {!rows.length && <p>No quote requests available.</p>}
        {!s[0] && rows.length === 50 && (
          <Link
            href={`?${new URLSearchParams({ before: rows[49].requestedAt, id: rows[49].requestId })}`}
          >
            More quote requests
          </Link>
        )}
      </main>
    </ServicesShell>
  );
}
