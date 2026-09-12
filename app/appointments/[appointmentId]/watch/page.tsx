import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { careContext } from "@/lib/care/data";
import { watchContext } from "@/lib/openings/data";
import { AppFrame } from "@/components/app-frame";
import { WatchForm } from "@/components/openings/form";
export const dynamic = "force-dynamic";
export default async function NewWatch({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const id = z.uuid().safeParse((await params).appointmentId);
  if (!id.success) notFound();
  const { db } = await careContext();
  const context = await watchContext(db, id.data);
  return (
    <AppFrame>
      <main className="care-page care-editor">
        <Link href={`/appointments/${id.data}`} className="account-back">
          ← Appointment
        </Link>
        <h1>Find an earlier opening.</h1>
        {context ? (
          <>
            <p>
              {context.provider_name} · {context.title}
            </p>
            {context.system === "mock" && (
              <p className="privacy-note">
                Demo availability. No live provider is connected.
              </p>
            )}
            <WatchForm appointmentId={id.data} startsAt={context.starts_at} />
          </>
        ) : (
          <p>
            Availability is not connected for this appointment. Your existing
            appointment has not changed.
          </p>
        )}
      </main>
    </AppFrame>
  );
}
