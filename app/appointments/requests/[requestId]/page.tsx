import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { ServicesShell } from "@/components/services/shell";
import { RequestDetails } from "@/components/appointment-requests/presentation";
import { RequestActions } from "@/components/appointment-requests/forms";
import type { RequestItem } from "@/lib/appointment-requests/schema";
export const dynamic = "force-dynamic";
export default async function RequestDetail({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { db } = await ownerSession();
  const id = z.uuid().safeParse((await params).requestId);
  if (!id.success) notFound();
  const r = await db.rpc("my_appointment_request", { p_request: id.data });
  if (r.error || !r.data) notFound();
  const item = r.data as RequestItem;
  return (
    <ServicesShell>
      <Link href="/appointments/requests">My appointment requests</Link>
      <RequestDetails item={item} />
      <RequestActions item={item} />
    </ServicesShell>
  );
}
