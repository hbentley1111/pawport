"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import type { ActionState } from "@/lib/types";
export async function changeConnection(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  const status = z
    .enum(["active", "paused", "revoked"])
    .safeParse(form.get("status"));
  if (!id.success || !status.success)
    return { error: "Check your connection action." };
  const { db } = await ownerSession();
  const { error } = await db.rpc("set_scheduling_connection_status", {
    p_id: id.data,
    p_status: status.data,
  });
  if (error)
    return {
      error:
        "Unable to change this connection. Scheduling permission is required.",
    };
  revalidatePath("/connections");
  revalidatePath("/appointments");
  revalidatePath("/");
  revalidatePath("/pets/[petId]", "page");
  return {
    success:
      status.data === "revoked"
        ? "Disconnected. Existing appointments are preserved."
        : "Connection status updated.",
  };
}
export async function decideMapping(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  const status = z
    .enum(["confirmed", "rejected", "disconnected"])
    .safeParse(form.get("status"));
  if (!id.success || !status.success)
    return { error: "Check your matching decision." };
  const { db } = await ownerSession();
  const { error } = await db.rpc("decide_external_pet_mapping", {
    p_id: id.data,
    p_status: status.data,
  });
  if (error) return { error: "Unable to update this pet connection." };
  revalidatePath("/connections");
  revalidatePath("/appointments");
  revalidatePath("/");
  revalidatePath("/pets/[petId]", "page");
  return {
    success:
      status.data === "confirmed"
        ? "Pet connection confirmed. Appointments appear after a successful sync."
        : "Pet connection updated. Appointment history is preserved.",
  };
}
