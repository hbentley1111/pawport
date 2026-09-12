"use server";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/types";
export async function notificationAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const action = z
      .enum(["read", "dismiss", "all"])
      .safeParse(form.get("action")),
    id = z.uuid().safeParse(form.get("id"));
  if (!action.success || (action.data !== "all" && !id.success))
    return { error: "Invalid notification action." };
  const { db } = await ownerSession();
  const r =
    action.data === "all"
      ? await db.rpc("mark_all_notifications_read")
      : await db.rpc("mark_notification_read", {
          p_id: id.success ? id.data : null,
          p_dismiss: action.data === "dismiss",
        });
  if (r.error) return { error: "Could not update notifications." };
  revalidatePath("/notifications");
  revalidatePath("/");
  return { success: "Saved." };
}
