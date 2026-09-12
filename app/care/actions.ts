"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { planInput, snoozePreset } from "@/lib/care-plans/schema";
import { wallTimeToISO } from "@/lib/care/time";
import type { ActionState } from "@/lib/types";
function refresh() {
  for (const p of ["/", "/care", "/care/plans"]) revalidatePath(p);
  revalidatePath("/care/plans/[planId]", "page");
  revalidatePath("/pets/[petId]", "page");
}
export async function savePlan(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.union([z.uuid(), z.literal("")]).safeParse(form.get("id") || ""),
    pet = z.uuid().safeParse(form.get("pet_id"));
  const interval = form.get("recurrence_type") === "interval";
  const parsed = planInput.safeParse({
    title: form.get("title"),
    category: form.get("category"),
    instructions: form.get("instructions") || "",
    recurrence_type: form.get("recurrence_type"),
    interval_value: interval ? Number(form.get("interval_value")) : null,
    interval_unit: interval ? form.get("interval_unit") : null,
    time_zone: form.get("time_zone"),
    anchor_local_date: form.get("anchor_local_date"),
    anchor_local_time: form.get("anchor_local_time") || "",
    ends_on: form.get("ends_on") || "",
    reminders: form.getAll("reminders").map(Number),
  });
  if (!parsed.success || !id.success || !pet.success)
    return {
      error: !parsed.success
        ? parsed.error.issues[0].message
        : "Choose a valid pet.",
    };
  const { db } = await ownerSession();
  const result = await db.rpc("save_care_plan", {
    p_id: id.data || null,
    p_pet: pet.data,
    p_data: parsed.data,
  });
  if (result.error)
    return {
      error:
        "Could not save this routine. Check the schedule and try again. Limits: 50 active routines per pet and 50 new routines per day.",
    };
  refresh();
  redirect(`/care/plans/${result.data}`);
}
export async function careAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  const action = z
    .enum([
      "complete",
      "skip",
      "snooze",
      "active",
      "paused",
      "archived",
      "read",
      "dismiss",
    ])
    .safeParse(form.get("action"));
  if (!id.success || !action.success) return { error: "Invalid care action." };
  const { db } = await ownerSession();
  let name: string;
  const args: Record<string, unknown> = { p_id: id.data };
  const a = action.data;
  if (a === "complete" || a === "skip") {
    const note = z
      .string()
      .max(500)
      .safeParse(form.get("note") || "");
    if (!note.success) return { error: "Keep the note within 500 characters." };
    name =
      a === "complete" ? "complete_care_occurrence" : "skip_care_occurrence";
    args.p_note = note.data;
  } else if (a === "snooze") {
    name = "snooze_care_occurrence";
    // Load the owned routine to derive timezone; the browser cannot choose a different plan's identity.
    const plans = await db.rpc("my_care_plans");
    const plan = (
      plans.data as
        { time_zone: string; occurrence: { id: string } | null }[] | null
    )?.find((p) => p.occurrence?.id === id.data);
    if (!plan) return { error: "Routine unavailable." };
    try {
      args.p_until =
        form.get("preset") === "custom"
          ? wallTimeToISO(String(form.get("until")), plan.time_zone, "later")
          : snoozePreset(String(form.get("preset")), plan.time_zone);
    } catch {
      return {
        error:
          "Choose a valid local date and time. A daylight saving gap may require a later time.",
      };
    }
  } else if (a === "read" || a === "dismiss") {
    name = "mark_notification_read";
    args.p_dismiss = a === "dismiss";
  } else {
    name = "set_care_plan_status";
    args.p_status = a;
  }
  const result = await db.rpc(name, args);
  if (result.error)
    return {
      error:
        a === "snooze"
          ? "Choose a time after the scheduled due time, within 30 days."
          : "Could not update this routine. Refresh and try again.",
    };
  refresh();
  return { success: "Saved." };
}
