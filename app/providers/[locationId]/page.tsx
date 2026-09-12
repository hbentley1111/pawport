import { LiveBookingLink } from "@/components/live-booking/owner";
import { requestIntake } from "@/lib/appointment-requests/data";
import { RequestCTA } from "@/components/appointment-requests/presentation";
import { notFound } from "next/navigation";
import { publicProfile } from "@/lib/business-profiles/data";
import { ServicesShell } from "@/components/services/shell";
import { BusinessProfile } from "@/components/business-profiles/presentation";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const p = await publicProfile((await params).locationId);
  return {
    title: p ? `${p.businessName} | Pawport` : "Business profile | Pawport",
    description: p?.tagline || "Business-provided information on Pawport.",
  };
}
export default async function Profile({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const p = await publicProfile((await params).locationId);
  if (!p) notFound();
  const intake = await requestIntake(p.locationId);
  return (
    <ServicesShell>
      <BusinessProfile profile={p} />
      <LiveBookingLink locationId={p.locationId} />
      {intake && <RequestCTA location={p.locationId} />}
    </ServicesShell>
  );
}
