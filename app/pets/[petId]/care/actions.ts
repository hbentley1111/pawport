"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { validTimeZone } from "@/lib/care/time";
export async function preventiveAction(
  _previous: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const pet = z.uuid().safeParse(form.get("pet"));
  if (!pet.success) return { error: "Choose a valid pet." };
  const { db } = await ownerSession();
  const action = form.get("action");
  let error;
  if (action === "profile") {
    const fields = [
      "indoor_outdoor",
      "social_exposure",
      "travel_frequency",
      "boarding_grooming_exposure",
      "wildlife_exposure",
      "owner_notes",
    ];
    const data: Record<string, unknown> = {};
    for (const key of fields) {
      const value = form.get(key);
      if (typeof value !== "string" || value.length > 500)
        return {
          error:
            "Check the profile fields (notes may contain up to 500 characters).",
        };
      data[key] =
        value === ""
          ? null
          : ["boarding_grooming_exposure", "wildlife_exposure"].includes(key)
            ? value === "yes"
              ? true
              : value === "no"
                ? false
                : value
            : value;
    }
    ({ error } = await db.rpc("save_pet_preventive_profile", {
      p_pet: pet.data,
      p_data: data,
    }));
  } else {
    const zone = String(form.get("zone") || ""),
      key = String(form.get("rule") || ""),
      state = String(form.get("state") || "");
    if (
      !validTimeZone(zone) ||
      zone.length > 100 ||
      !/^[a-z0-9_]{1,100}$/.test(key)
    )
      return { error: "Check the topic and time zone." };
    ({ error } = await db.rpc("set_preventive_guidance_state", {
      p_pet: pet.data,
      p_rule_key: key,
      p_state: state,
      p_snoozed_until: state === "snoozed" ? form.get("until") : null,
      p_zone: zone,
    }));
  }
  if (error)
    return {
      error:
        "Unable to save. Check your choices and use a reminder date within three months.",
    };
  revalidatePath(`/pets/${pet.data}/care`, "layout");
  return {
    success:
      action === "profile"
        ? "Care profile saved. These answers stay private."
        : "Discussion preference saved. No medical record or care schedule changed.",
  };
}
