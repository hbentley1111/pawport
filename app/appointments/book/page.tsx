import { notFound } from "next/navigation";
import { z } from "zod";
import { careContext } from "@/lib/care/data";
import { ServicesShell } from "@/components/services/shell";
import { LiveBookingForm } from "@/components/live-booking/owner";
export const dynamic = "force-dynamic";
export default async function Book({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; serviceId?: string }>;
}) {
  const p = await searchParams;
  if (!z.uuid().safeParse(p.locationId).success) notFound();
  const { db, pets } = await careContext();
  const [{ data: profile }, { data: intake }] = await Promise.all([
    db.rpc("service_provider_public_profile", { p_location: p.locationId }),
    db.rpc("service_provider_request_intake", { p_location: p.locationId }),
  ]);
  if (!profile) notFound();
  return (
    <ServicesShell>
      <header className="business-heading">
        <p className="eyebrow">{profile.businessName}</p>
        <h1>Live appointment times</h1>
        <p>Select a time, then review and confirm.</p>
      </header>
      <LiveBookingForm
        locationId={p.locationId!}
        serviceId={p.serviceId}
        pets={pets.map((p) => ({ id: p.id, name: p.name }))}
        fallback={!!intake}
      />
    </ServicesShell>
  );
}
