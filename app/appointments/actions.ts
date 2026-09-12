"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import { normalizeAppointment } from "@/lib/care/schema";
import type { ActionState } from "@/lib/types";
function refresh() {
  revalidatePath("/");
  revalidatePath("/appointments");
  revalidatePath("/pets/[petId]", "page");
  revalidatePath("/appointments/[appointmentId]", "page");
}
export async function saveAppointment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  let normalized;
  try {
    const values = Object.fromEntries(
      [
        "pet_id",
        "title",
        "appointment_type",
        "local_start",
        "local_end",
        "time_zone",
        "start_occurrence",
        "end_occurrence",
        "status",
        "provider_name",
        "location_text",
        "notes",
        "google_place_id",
      ].map((k) => [k, form.get(k)]),
    );
    normalized = normalizeAppointment({
      ...values,
      reminders: form.getAll("reminders").map(Number),
    });
  } catch (error) {
    return {
      error:
        error instanceof z.ZodError
          ? error.issues[0].message
          : error instanceof Error
            ? error.message
            : "Check your appointment details.",
    };
  }
  const id = form.get("id");
  if (id && !z.uuid().safeParse(id).success)
    return { error: "Invalid appointment." };
  const { db } = await ownerSession();
  const { data, error } = await db.rpc("save_manual_appointment", {
    p_id: id || null,
    p_pet: normalized.pet,
    p_data: normalized.data,
    p_reminders: normalized.reminders,
  });
  if (error)
    return {
      error:
        "Could not save this appointment. Check your details and try again. You can add up to 100 appointments per day.",
    };
  refresh();
  revalidatePath(`/appointments/${data}`);
  redirect(`/appointments/${data}?saved=1`);
}
export async function cancelAppointment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid appointment." };
  const { db } = await ownerSession();
  const { error } = await db.rpc("cancel_manual_appointment", {
    p_id: id.data,
  });
  if (error) return { error: "Could not cancel this appointment." };
  refresh();
  revalidatePath(`/appointments/${id.data}`);
  return {
    success:
      "Marked cancelled in Pawport. Contact the provider separately to cancel with them.",
  };
}
export async function dismissReminder(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid reminder." };
  const { db } = await ownerSession();
  const { error } = await db.rpc("dismiss_appointment_reminder", {
    p_id: id.data,
  });
  if (error) return { error: "Could not dismiss this reminder." };
  refresh();
  return { success: "Reminder dismissed in Pawport." };
}
