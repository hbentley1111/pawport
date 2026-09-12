import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { providerDashboard } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import { RequestDetails } from "@/components/appointment-requests/presentation";
import { RequestActions } from "@/components/appointment-requests/forms";
import type { RequestItem } from "@/lib/appointment-requests/schema";
export const dynamic = "force-dynamic";
export default async function ProviderRequest({
  params,
}: {
  params: Promise<{ organizationId: string; requestId: string }>;
}) {
  const { db } = await ownerSession();
  const p = await params;
  if (
    !z.uuid().safeParse(p.organizationId).success ||
    !z.uuid().safeParse(p.requestId).success
  )
    notFound();
  const [r, dashboard] = await Promise.all([
    db.rpc("service_provider_appointment_request", {
      p_organization: p.organizationId,
      p_request: p.requestId,
    }),
    providerDashboard(db),
  ]);
  const org = dashboard?.find((o) => o.id === p.organizationId);
  if (r.error || !r.data || !org) notFound();
  const item = r.data as RequestItem;
  return (
    <ServicesShell>
      <Link href={`/provider/businesses/${org.id}/requests`}>
        Appointment request inbox
      </Link>
      <RequestDetails item={item} />
      <RequestActions
        item={item}
        org={org.id}
        canRespond={org.role !== "staff"}
      />
    </ServicesShell>
  );
}
