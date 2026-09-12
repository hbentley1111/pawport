import Link from "next/link";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { ServicesShell } from "@/components/services/shell";
import { RequestList } from "@/components/appointment-requests/presentation";
import type { RequestItem } from "@/lib/appointment-requests/schema";
export const dynamic = "force-dynamic";
export default async function Requests({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; id?: string; view?: string }>;
}) {
  const { db } = await ownerSession();
  const p = await searchParams;
  const cursor = z
    .object({ before: z.iso.datetime({ offset: true }), id: z.uuid() })
    .safeParse(p);
  const result = await db.rpc(
    "my_appointment_requests",
    cursor.success
      ? { p_before: cursor.data.before, p_before_id: cursor.data.id }
      : {},
  );
  const items = (result.data || []) as RequestItem[];
  const last = items.at(-1);
  const groups = [
    ["Waiting for business", ["requested"]],
    ["Business proposed a time", ["provider_proposed"]],
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
      <Link href="/appointments">Appointments</Link>
      <header className="business-heading">
        <h1>Appointment requests</h1>
        <p>The business will confirm or suggest another time.</p>
        <Link href="/services">Find a business</Link>
      </header>
      {result.error ? (
        <p role="status">Requests are temporarily unavailable.</p>
      ) : items.length ? (
        groups.map(([label, statuses]) => {
          const selected = items.filter((r) =>
            (statuses as readonly string[]).includes(r.status),
          );
          return selected.length ? (
            <section key={label}>
              <h2>{label}</h2>
              <RequestList items={selected} base="/appointments/requests" />
            </section>
          ) : null;
        })
      ) : (
        <RequestList items={[]} base="/appointments/requests" />
      )}
      {items.length === 25 && last && (
        <Link
          className="button secondary"
          href={`/appointments/requests?${new URLSearchParams({ before: last.createdAt, id: last.requestId })}`}
        >
          Older requests
        </Link>
      )}
    </ServicesShell>
  );
}
