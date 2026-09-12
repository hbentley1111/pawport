"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import { journalInput } from "@/lib/timeline/schema";
import { wallTimeToISO } from "@/lib/care/time";
import type { ActionState } from "@/lib/types";
export async function saveMoment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.union([z.uuid(), z.literal("")]).safeParse(form.get("id") || ""),
    pet = z.uuid().safeParse(form.get("pet_id"));
  let occurred: string;
  try {
    occurred = wallTimeToISO(
      String(form.get("local_time")),
      String(form.get("time_zone")),
      form.get("fold") === "later" ? "later" : "earlier",
    );
  } catch {
    return {
      error:
        "Choose a valid local date and time. Times inside a daylight saving gap are unavailable.",
    };
  }
  const type = form.get("entry_type");
  const parsed = journalInput.safeParse({
    entry_type: type,
    title: form.get("title") || "",
    note: form.get("note") || "",
    occurred_at: occurred,
    time_zone: form.get("time_zone"),
    weight_value: type === "weight" ? Number(form.get("weight_value")) : null,
    weight_unit: type === "weight" ? form.get("weight_unit") : null,
    photo_id: type === "photo" ? form.get("photo_id") || null : null,
  });
  if (!id.success || !pet.success || !parsed.success)
    return {
      error: !parsed.success
        ? parsed.error.issues[0].message
        : "Invalid moment.",
    };
  const { db } = await ownerSession();
  const r = await db.rpc("save_pet_journal_entry", {
    p_id: id.data || null,
    p_pet: pet.data,
    p_data: parsed.data,
  });
  if (r.error)
    return {
      error:
        "Could not save this moment. Check the photo and date, or try again later. Limit: 50 new moments per day.",
    };
  revalidatePath(`/pets/${pet.data}`, "layout");
  revalidatePath("/");
  redirect(`/pets/${pet.data}/timeline`);
}
export async function deleteMoment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id")),
    pet = z.uuid().safeParse(form.get("pet_id"));
  if (!id.success || !pet.success) return { error: "Invalid moment." };
  const { db } = await ownerSession();
  const owned = await db.rpc("my_pet_journal_entry", {
    p_pet: pet.data,
    p_id: id.data,
  });
  if (!owned.data || owned.error) return { error: "Moment unavailable." };
  const r = await db.rpc("delete_pet_journal_entry", { p_id: id.data });
  if (r.error) return { error: "Could not delete this moment." };
  revalidatePath(`/pets/${pet.data}`, "layout");
  revalidatePath("/");
  redirect(`/pets/${pet.data}/timeline`);
}
