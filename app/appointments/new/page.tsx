import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { AppointmentForm } from "@/components/care/form";
import { careContext } from "@/lib/care/data";
import { placeIdSchema } from "@/lib/services/schema";
export const dynamic = "force-dynamic";
export default async function NewAppointment({
  searchParams,
}: {
  searchParams: Promise<{ pet?: string; place?: string }>;
}) {
  const params = await searchParams;
  const { pets } = await careContext();
  const place = placeIdSchema.safeParse(params.place);
  return (
    <AppFrame>
      <main className="care-page care-editor">
        <Link href="/appointments" className="account-back">
          ← Your care calendar
        </Link>
        <p className="eyebrow">A LITTLE PLANNING. A LOT OF CARE.</p>
        <h1>Add an appointment.</h1>
        <AppointmentForm
          pets={pets}
          petId={pets.some((p) => p.id === params.pet) ? params.pet : undefined}
          placeId={place.success ? place.data : undefined}
        />
      </main>
    </AppFrame>
  );
}
