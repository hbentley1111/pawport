import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { appointmentCalendar } from "@/lib/care/ics";
import { careFields } from "@/lib/care/data";
import type { Appointment } from "@/lib/care/schema";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noarchive",
};
export async function GET(
  _: Request,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  const id = z.uuid().safeParse((await params).appointmentId);
  if (!id.success) return new Response("Not found", { status: 404, headers });
  if (!configured())
    return new Response("Unavailable", { status: 503, headers });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return new Response("Sign in to export your appointment", {
      status: 401,
      headers,
    });
  const { data, error } = await db
    .from("appointments")
    .select(careFields)
    .eq("id", id.data)
    .maybeSingle();
  if (error)
    return new Response("Calendar is temporarily unavailable", {
      status: 503,
      headers,
    });
  if (!data) return new Response("Not found", { status: 404, headers });
  const appointment = data as unknown as Appointment;
  const pet = await db
    .from("pets")
    .select("name")
    .eq("id", appointment.pet_id)
    .maybeSingle();
  if (pet.error || !pet.data)
    return new Response("Not found", { status: 404, headers });
  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    if (
      process.env.NODE_ENV === "production" &&
      new URL(origin).protocol !== "https:"
    )
      throw new Error("Configure HTTPS");
    return new Response(
      appointmentCalendar(appointment, pet.data.name, origin),
      {
        headers: {
          ...headers,
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="petthread-care.ics"',
        },
      },
    );
  } catch {
    return new Response("Calendar export is temporarily unavailable", {
      status: 503,
      headers,
    });
  }
}
