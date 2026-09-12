import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { providerDashboard } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import { ProviderDashboard } from "@/components/provider-dashboard/dashboard";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const { db } = await ownerSession();
  const organizations = await providerDashboard(db);
  return (
    <ServicesShell>
      {organizations ? (
        <ProviderDashboard organizations={organizations} />
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
