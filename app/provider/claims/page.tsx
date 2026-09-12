import Link from "next/link";
import { z } from "zod";
import { ServicesShell } from "@/components/services/shell";
import { ClaimCard } from "@/components/provider-claiming/presentation";
import { WithdrawClaim } from "@/components/provider-claiming/forms";
import { claimantSession, claimantClaims } from "@/lib/provider-claiming/data";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
} from "@/lib/timeline/data";
export const dynamic = "force-dynamic";
export default async function Claims({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; submitted?: string }>;
}) {
  const { db } = await claimantSession(),
    q = await searchParams;
  let cursor = null,
    bad = false;
  try {
    cursor = decodeTimelineCursor(q.cursor);
    if (cursor && !z.uuid().safeParse(cursor.id).success) bad = true;
  } catch {
    bad = true;
  }
  const page = bad ? null : await claimantClaims(db, cursor);
  return (
    <ServicesShell>
      <Link className="button secondary" href="/provider/businesses">
        Manage business profiles
      </Link>
      <div className="claim-page">
        <header className="care-heading">
          <div>
            <p className="eyebrow">YOUR BUSINESS REQUESTS</p>
            <h1>My claims</h1>
            <p className="muted">
              Follow your requests to represent a business on Pawport.
            </p>
          </div>
          <Link className="document-link" href="/services">
            Find a business
          </Link>
        </header>
        {q.submitted === "1" && (
          <p role="status">Claim submitted for manual review.</p>
        )}
        {!page ? (
          <p role="status">
            {bad
              ? "This page link is invalid."
              : "Claims are temporarily unavailable."}{" "}
            <Link href="/provider/claims">Start again</Link>
          </p>
        ) : page.claims.length ? (
          <div>
            {page.claims.map((c) => (
              <ClaimCard key={c.id} claim={c}>
                {c.status === "pending" && <WithdrawClaim id={c.id} />}
              </ClaimCard>
            ))}
          </div>
        ) : (
          <section className="claim-card">
            <h2>No claims yet.</h2>
            <p>
              Find your business in Local Services and choose Claim this
              listing.
            </p>
            <Link className="button secondary" href="/services">
              Explore Local Services
            </Link>
          </section>
        )}
        {page?.nextCursor && (
          <Link
            className="button secondary"
            href={`/provider/claims?cursor=${encodeTimelineCursor(page.nextCursor)}`}
          >
            Load more
          </Link>
        )}
        {cursor && (
          <Link className="document-link" href="/provider/claims">
            Back to latest
          </Link>
        )}
        <Link className="document-link" href="/account">
          Your account
        </Link>
      </div>
    </ServicesShell>
  );
}
