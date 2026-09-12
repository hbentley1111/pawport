import { notFound } from "next/navigation";
import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { OwnerAppFrame } from "@/components/owner-app-frame";
import { schedulingAdapter } from "@/lib/scheduling/registry";
export const dynamic = "force-dynamic";
export default async function Demo() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAWPORT_ENABLE_MOCK_SCHEDULING !== "true" ||
    process.env.VERCEL_ENV === "production"
  )
    notFound();
  await ownerSession();
  const connection = { id: "local-demo", externalSystem: "mock" as const };
  const adapter = schedulingAdapter("mock", connection.id);
  const valid = await adapter.validateConnection(connection);
  const pets = await adapter.listExternalPets!(connection);
  const { appointments } = await adapter.listAppointments!(connection, {
    from: "2027-01-01T00:00:00Z",
    to: "2028-01-01T00:00:00Z",
  });
  return (
    <OwnerAppFrame>
      <main className="care-page">
        <Link href="/connections">← Provider connections</Link>
        <p className="eyebrow">LOCAL DEVELOPMENT ONLY</p>
        <h1>Demo Scheduling System</h1>
        <section className="account-card">
          <h2>{valid ? "Demo connection validated" : "Demo unavailable"}</h2>
          <p>
            This preview uses fictional data in memory. It does not save a
            connection, match your pets, or book an appointment.
          </p>
          <p>
            {pets.length} fictional pet · {appointments.length} fictional
            appointment
          </p>
          <p>{appointments[0]?.title}</p>
          <p>
            For the complete consent → import → reschedule → disconnect
            pipeline, run the scheduling integration tests against their
            isolated local database.
          </p>
        </section>
      </main>
    </OwnerAppFrame>
  );
}
