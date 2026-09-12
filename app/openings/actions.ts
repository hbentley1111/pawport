"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import { watchContext } from "@/lib/openings/data";
import { watchInput } from "@/lib/openings/schema";
import type { ActionState } from "@/lib/types";
function refresh() {
  revalidatePath("/");
  revalidatePath("/openings");
  revalidatePath("/openings/[watchId]", "page");
  revalidatePath("/appointments/[appointmentId]", "page");
  revalidatePath("/pets/[petId]", "page");
}
export async function saveWatch(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const appointment = z.uuid().safeParse(form.get("appointment_id")),
    watch = z.union([z.uuid(), z.literal("")]).safeParse(form.get("id") || "");
  const parsed = watchInput.safeParse({
    earliest_date: form.get("earliest_date"),
    latest_date: form.get("latest_date"),
    earliest_time: form.get("earliest_time"),
    latest_time: form.get("latest_time"),
    time_zone: form.get("time_zone"),
    allowed_weekdays: form.getAll("allowed_weekdays").map(Number),
  });
  if (!appointment.success || !watch.success || !parsed.success)
    return {
      error: !parsed.success
        ? parsed.error.issues[0].message
        : "Invalid appointment.",
    };
  const { db } = await ownerSession();
  const context = await watchContext(db, appointment.data);
  if (!context)
    return {
      error:
        "This appointment does not have a compatible active availability connection.",
    };
  const { data, error } = await db.rpc("save_availability_watch", {
    p_id: watch.data || null,
    p_pet: context.pet_id,
    p_connection: context.connection_id,
    p_appointment: appointment.data,
    p_data: parsed.data,
  });
  if (error)
    return {
      error:
        "Could not save this watch. Choose dates within the next 90 days. Only one open watch per appointment is allowed.",
    };
  refresh();
  redirect(`/openings/${data}`);
}
export async function watchAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  const action = z
    .enum([
      "active",
      "paused",
      "cancelled",
      "dismiss_match",
      "read",
      "dismiss_notification",
    ])
    .safeParse(form.get("action"));
  if (!id.success || !action.success) return { error: "Invalid action." };
  const { db } = await ownerSession();
  const a = action.data;
  const result =
    a === "dismiss_match"
      ? await db.rpc("dismiss_availability_match", { p_id: id.data })
      : a === "read" || a === "dismiss_notification"
        ? await db.rpc("mark_notification_read", {
            p_id: id.data,
            p_dismiss: a === "dismiss_notification",
          })
        : await db.rpc("set_availability_watch_status", {
            p_id: id.data,
            p_status: a,
          });
  if (result.error)
    return {
      error:
        "Unable to update. This watch may have ended or its connection may be unavailable.",
    };
  refresh();
  return { success: "Updated." };
}
