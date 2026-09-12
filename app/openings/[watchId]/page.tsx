import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { careContext } from "@/lib/care/data";
import { openingsData } from "@/lib/openings/data";
import { AppFrame } from "@/components/app-frame";
import { WatchCard } from "@/components/openings/watch-card";
import { WatchForm } from "@/components/openings/form";
export const dynamic = "force-dynamic";
export default async function WatchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ watchId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const id = z.uuid().safeParse((await params).watchId);
  if (!id.success) notFound();
  const { db } = await careContext();
  const data = await openingsData(db);
  const w = data.watches.find((w) => w.id === id.data);
  if (!w && !data.error) notFound();
  const edit = (await searchParams).edit === "1";
  return (
    <AppFrame>
      <main className="care-page care-editor">
        <Link href="/openings" className="account-back">
          ← Openings
        </Link>
        <h1>Your opening watch.</h1>
        {data.error ? (
          <p role="status">Smart Openings is temporarily unavailable.</p>
        ) : (
          w && (
            <>
              <WatchCard watch={w} detail />
              {edit &&
                w.appointment_id &&
                w.current_appointment_start &&
                !["expired", "cancelled"].includes(w.status) && (
                  <WatchForm
                    watch={w}
                    appointmentId={w.appointment_id}
                    startsAt={w.current_appointment_start}
                  />
                )}
            </>
          )
        )}
      </main>
    </AppFrame>
  );
}
