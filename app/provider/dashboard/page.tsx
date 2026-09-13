import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { providerDashboard } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import { ProviderDashboard } from "@/components/provider-dashboard/dashboard";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const { db } = await ownerSession();
  const organizations = await providerDashboard(db);
  const ecosystemCounts = Object.fromEntries(
    await Promise.all(
      (organizations || [])
        .filter((o) => o.status === "active")
        .map(async (o) => {
          const { data } = await db.rpc("ecosystem_dashboard_summary", {
            p_org: o.id,
          });
          return [o.id, data] as const;
        }),
    ),
  );
  return (
    <ServicesShell>
      {organizations ? (
        <ProviderDashboard
          organizations={organizations}
          ecosystemCounts={ecosystemCounts}
        />
      ) : (
        <p role="status">Business dashboard is temporarily unavailable.</p>
      )}
      <footer className="provider-workspace-links">
        <Link href="/account">Account & pet-owner workspace</Link>
        <Link href="/provider">Veterinary verification (separate access)</Link>
      </footer>
    </ServicesShell>
  );
}
