"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
export async function saveBinding(
  _: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const parsed = z
    .object({
      org: z.uuid(),
      location: z.uuid(),
      service: z.uuid(),
      connection: z.uuid(),
      type: z.string().regex(/^appointmentType_[A-Za-z0-9]{21}$/),
      duration: z.coerce.number().int().min(10).max(360).multipleOf(5),
      resources: z
        .array(z.string().regex(/^resource_[A-Za-z0-9]{21}$/))
        .min(1)
        .max(25),
      enabled: z.boolean(),
    })
    .safeParse({
      org: form.get("org"),
      location: form.get("location"),
      service: form.get("service"),
      connection: form.get("connection"),
      type: form.get("type"),
      duration: form.get("duration"),
      resources: form.getAll("resources"),
      enabled: form.get("enabled") === "on",
    });
  if (!parsed.success)
    return {
      error:
        "Choose a service, appointment type, duration and at least one resource.",
    };
  const p = parsed.data,
    { db } = await ownerSession();
  const { error } = await db.rpc("save_live_booking_binding", {
    p_organization: p.org,
    p_location: p.location,
    p_service: p.service,
    p_connection: p.connection,
    p_type: p.type,
    p_duration: p.duration,
    p_resources: p.resources,
    p_enabled: p.enabled,
  });
  if (error)
    return {
      error:
        "Unable to save. Business access and explicit scheduling permission are both required.",
    };
  revalidatePath(`/provider/businesses/${p.org}/live-booking`);
  return {
    success:
      "Service configuration saved. Production booking remains disabled.",
  };
}
