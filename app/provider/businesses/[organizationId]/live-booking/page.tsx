import { ConnectedOperations } from "@/components/live-booking/connected-operations";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { providerDashboard } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import {
  LiveConfiguration,
  type Configuration,
} from "@/components/live-booking/provider";
export const dynamic = "force-dynamic";
export default async function LiveSettings({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const { organizationId: org } = await params;
  if (!z.uuid().safeParse(org).success) notFound();
  const { db } = await ownerSession(),
    business = (await providerDashboard(db))?.find((o) => o.id === org);
  if (!business || business.status !== "active") notFound();
  const query = await searchParams,
    location =
      business.locations.find((l) => l.id === query.location) ||
      (!query.location ? business.locations[0] : undefined);
  if (!location) notFound();
  const [{ data, error }, appointments] = await Promise.all([
    db.rpc("my_live_booking_configuration", {
      p_organization: org,
      p_location: location.id,
    }),
    db.rpc("my_connected_appointments", {
      p_organization: org,
      p_location: location.id,
    }),
  ]);
  if (error || !data) notFound();
  const items = (appointments.data || []) as {
    appointmentId: string;
    title: string;
    petName: string;
    startsAt: string;
    timeZone: string;
    status: string;
    mutationState: string | null;
    canManage: boolean;
  }[];
  return (
    <ServicesShell>
      <Link href="/provider/dashboard">Business dashboard</Link>
      <header className="business-heading">
        <p className="eyebrow">{business.name}</p>
        <h1>Live booking configuration</h1>
      </header>
      <form className="business-panel business-form">
        <label>
          Location
          <select name="location" defaultValue={location.id}>
            {business.locations.map((l) => (
              <option value={l.id} key={l.id}>
                {l.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary">Show location</button>
      </form>
      <LiveConfiguration org={org} data={data as Configuration} />
      <section>
        <h2>PetThread live appointments</h2>
        {!items.length && <p>No recent live appointments at this location.</p>}
        {items.map((a) => (
          <article className="business-panel" key={a.appointmentId}>
            <h3>{a.title}</h3>
            <p>
              {a.petName} ·{" "}
              {new Intl.DateTimeFormat("en-US", {
                timeZone: a.timeZone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(a.startsAt))}{" "}
              · {a.status}
            </p>
            {a.canManage && a.status !== "cancelled" && (
              <ConnectedOperations
                initialState={{
                  canCancel: false,
                  canReschedule: false,
                  mutationState: a.mutationState,
                }}
                appointmentId={a.appointmentId}
                summary={`${a.petName} · ${a.title}`}
                autoLoad={false}
              />
            )}
          </article>
        ))}
      </section>
    </ServicesShell>
  );
}
