import { ExternalAppointmentNotice } from "@/components/scheduling/presentation";
import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/app-frame";
import { AppointmentForm, CancelAppointment } from "@/components/care/form";
import { ExternalCare } from "@/components/scheduling/external-care";
import { careContext, careFields } from "@/lib/care/data";
import type { Appointment } from "@/lib/care/schema";
export const dynamic = "force-dynamic";
export default async function AppointmentDetail({
  params,
  searchParams,
}: {
  params: Promise<{ appointmentId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const id = z.uuid().safeParse((await params).appointmentId);
  if (!id.success) notFound();
  const { db, pets, household } = await careContext();
  const result = await db
    .from("appointments")
    .select(`${careFields},notes`)
    .eq("household_id", household.id)
    .eq("id", id.data)
    .maybeSingle();
  if (result.error)
    return (
      <AppFrame>
        <main className="care-page">
          <h1>Care calendar unavailable.</h1>
          <Link href="/appointments">Back to care calendar</Link>
        </main>
      </AppFrame>
    );
  if (!result.data) notFound();
  const a = result.data as unknown as Appointment;
  const pet = pets.find((p) => p.id === a.pet_id);
  if (!pet) notFound();
  const { saved } = await searchParams;
  return (
    <AppFrame>
      <main className="care-page care-editor">
        <Link href="/appointments" className="account-back">
          ← Your care calendar
        </Link>
        <p className="eyebrow">{pet.name}’S CARE</p>
        <h1>{a.title}</h1>
        {saved === "1" && (
          <p role="status" className="feedback success">
            Appointment saved in Pawport.
          </p>
        )}
        <div className="care-page-links">
          <a
            href={`/appointments/${a.id}/calendar`}
            className="button secondary"
          >
            Add to calendar
          </a>
          {a.google_place_id && (
            <Link
              href={`/services/${encodeURIComponent(a.google_place_id)}`}
              prefetch={false}
              className="document-link"
            >
              Current business information
            </Link>
          )}
        </div>
        <p className="fine-print">
          Calendar export includes pet name and your provider/location entries,
          but excludes private notes. Exported events do not sync automatically.
        </p>
        {a.status === "cancelled" && a.source === "manual" && (
          <p role="status" className="feedback">
            Cancelled in Pawport. This does not cancel with the provider.
          </p>
        )}
        {a.source === "manual" ? (
          <AppointmentForm key={a.updated_at} appointment={a} pets={pets} />
        ) : (
          <>
            <ExternalCare
              appointment={a}
              pet={pet}
              now={new Date().getTime()}
            />
            <ExternalAppointmentNotice state={a.sync_state} />
          </>
        )}
        {a.source === "manual" && a.status !== "cancelled" && (
          <CancelAppointment id={a.id} />
        )}
      </main>
    </AppFrame>
  );
}
