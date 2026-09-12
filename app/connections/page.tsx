import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { OwnerAppFrame } from "@/components/owner-app-frame";
import {
  SchedulingStatus,
  NoSchedulingConnections,
} from "@/components/scheduling/status";
import type {
  ConnectionSummary,
  MappingSummary,
} from "@/lib/scheduling/schema";
export const dynamic = "force-dynamic";
export default async function Connections() {
  const { db } = await ownerSession();
  const [connections, mappings] = await Promise.all([
    db.rpc("my_scheduling_connections"),
    db.rpc("my_external_pet_mappings"),
  ]);
  const rows = (connections.data || []) as ConnectionSummary[],
    matches = (mappings.data || []) as MappingSummary[];
  return (
    <OwnerAppFrame>
      <main className="care-page">
        <Link href="/account" className="account-back">
          ← Account
        </Link>
        <p className="eyebrow">CARE, CONNECTED WITH CONSENT</p>
        <h1>Provider connections.</h1>
        <p className="muted">
          A private view of the providers connected to your care.
        </p>
        <div className="care-page-links">
          <Link href="/appointments">Care calendar</Link>
          <Link href="/provider">Provider verification</Link>
        </div>
        {connections.error || mappings.error ? (
          <p role="status">
            Scheduling connections are temporarily unavailable.
          </p>
        ) : !rows.length ? (
          <NoSchedulingConnections />
        ) : (
          <div className="scheduling-grid">
            {rows.map((c) => (
              <SchedulingStatus
                key={c.id}
                connection={c}
                mappings={matches.filter((m) => m.connection_id === c.id)}
              />
            ))}
          </div>
        )}
        {process.env.NODE_ENV === "development" &&
          process.env.PAWPORT_ENABLE_MOCK_SCHEDULING === "true" &&
          process.env.VERCEL_ENV !== "production" && (
            <Link href="/connections/demo" className="button secondary">
              Explore demo connection
            </Link>
          )}
      </main>
    </OwnerAppFrame>
  );
}
