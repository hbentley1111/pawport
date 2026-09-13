import Link from "next/link";
import { careContext } from "@/lib/care/data";
import { requestIntake } from "@/lib/appointment-requests/data";
import { ServicesShell } from "@/components/services/shell";
import { RequestForm } from "@/components/appointment-requests/forms";
export const dynamic = "force-dynamic";
export default async function NewRequest({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  const { pets } = await careContext();
  const intake = await requestIntake((await searchParams).locationId || "");
  return (
    <ServicesShell>
      <Link href="/appointments/requests">My appointment requests</Link>
      {intake ? (
        <>
          <header className="business-heading">
            <p className="eyebrow">REQUEST APPOINTMENT</p>
            <h1>{intake.businessName}</h1>
            <p>{intake.locationName}</p>
          </header>
          <RequestForm
            intake={intake}
            pets={pets.map((p) => ({ id: p.id, name: p.name }))}
          />
        </>
      ) : (
        <section className="business-panel">
          <h1>Appointment requests unavailable</h1>
          <p>
            This location is not accepting PetThread appointment requests right
            now.
          </p>
          <Link href="/services">Find local services</Link>
        </section>
      )}
    </ServicesShell>
  );
}
