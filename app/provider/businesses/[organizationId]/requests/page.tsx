import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { providerDashboard } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import { RequestList } from "@/components/appointment-requests/presentation";
import { IntakeSettings } from "@/components/appointment-requests/forms";
import type {
  RequestItem,
  RequestSettings,
} from "@/lib/appointment-requests/schema";
export const dynamic = "force-dynamic";
export default async function Inbox({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    location?: string;
    before?: string;
    id?: string;
    view?: string;
  }>;
}) {
  const { db } = await ownerSession();
  const { organizationId: org } = await params;
  if (!z.uuid().safeParse(org).success) notFound();
  const dashboard = await providerDashboard(db);
  const business = dashboard?.find((o) => o.id === org);
  if (!business || business.status !== "active") notFound();
  const p = await searchParams;
  const location = business.locations.find((l) => l.id === p.location);
  if (p.location && !location) notFound();
  const cursor = z
    .object({ before: z.iso.datetime({ offset: true }), id: z.uuid() })
    .safeParse(p);
  const [requests, settings] = await Promise.all([
    db.rpc("service_provider_appointment_requests", {
      p_organization: org,
      p_location: location?.id || null,
      ...(cursor.success
        ? { p_before: cursor.data.before, p_before_id: cursor.data.id }
        : {}),
    }),
    location
      ? db.rpc("service_provider_request_settings", {
          p_organization: org,
          p_location: location.id,
        })
      : null,
  ]);
  const items = (requests.data || []) as RequestItem[];
  const last = items.at(-1);
  const base = `/provider/businesses/${org}/requests`;
  const groups = [
    ["New", ["requested"]],
    ["Waiting on owner", ["provider_proposed"]],
    ["Confirmed", ["confirmed"]],
    [
      "Closed",
      [
        "declined",
        "withdrawn",
        "cancelled_by_owner",
        "cancelled_by_provider",
        "expired",
      ],
    ],
  ] as const;
  return (
    <ServicesShell>
      <Link href="/provider/dashboard">Business dashboard</Link>
      <header className="business-heading">
        <p className="eyebrow">{business.name}</p>
        <h1>Appointment requests</h1>
        <p>
          Respond to preferred times, or suggest another time for the owner to
          review.
        </p>
      </header>
      <form className="business-panel business-form">
        <label>
          Location
          <select name="location" defaultValue={location?.id || ""}>
            <option value="">All accessible locations</option>
            {business.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary">Show location</button>
      </form>
      {requests.error ? (
        <p role="status">Requests are temporarily unavailable.</p>
      ) : items.length ? (
        groups.map(([label, statuses]) => {
          const selected = items.filter((r) =>
            (statuses as readonly string[]).includes(r.status),
          );
          return selected.length ? (
            <section key={label}>
              <h2>{label}</h2>
              <RequestList items={selected} base={base} />
            </section>
          ) : null;
        })
      ) : (
        <RequestList items={[]} base={base} />
      )}{" "}
      {items.length === 25 && last && (
        <Link
          className="button secondary"
          href={`${base}?${new URLSearchParams({ before: last.createdAt, id: last.requestId, location: location?.id || "" })}`}
        >
          Older requests
        </Link>
      )}
      {business.role !== "staff" && settings?.data && (
        <IntakeSettings org={org} data={settings.data as RequestSettings} />
      )}{" "}
      {!location && business.role !== "staff" && (
        <p>
          Select a location to configure request intake and requestable
          services.
        </p>
      )}
    </ServicesShell>
  );
}
