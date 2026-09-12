"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/types";
import { claimInput } from "@/lib/provider-claiming/schema";
import {
  claimantSession,
  confirmClaimPlace,
} from "@/lib/provider-claiming/data";
export async function submitClaim(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const input = claimInput.safeParse({
    placeId: form.get("placeId"),
    requested_organization_id: form.get("requested_organization_id") || "",
    organization_name: form.get("organization_name"),
    claimant_role: form.get("claimant_role"),
    business_email: String(form.get("business_email") || "").trim(),
    claim_note: form.get("claim_note") || "",
  });
  if (!input.success) return { error: input.error.issues[0].message };
  const { db, user } = await claimantSession();
  try {
    await confirmClaimPlace(user.id, input.data.placeId);
  } catch {
    return {
      error:
        "We couldn't confirm this Google listing right now. Try again before submitting your claim.",
    };
  }
  const { placeId, ...fields } = input.data;
  const result = await db.rpc("submit_service_provider_claim", {
    p_place: placeId,
    p_data: fields,
  });
  if (result.error) {
    const safe: Record<string, string> = {
      "Claim limit reached": "You can submit up to 10 claims in 30 days.",
      "Listing already claimed":
        "This business has already been claimed on Pawport.",
      "Claim already pending":
        "You already have a pending claim for this listing.",
      "Organization management required":
        "Choose an active organization you own or administer.",
    };
    return {
      error:
        safe[result.error.message] ||
        "Could not submit your claim. Check your information and try again.",
    };
  }
  revalidatePath("/provider/claims");
  redirect("/provider/claims?submitted=1");
}
export async function withdrawClaim(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success || form.get("confirm") !== "yes")
    return { error: "Confirm that you want to withdraw this pending claim." };
  const { db } = await claimantSession();
  const r = await db.rpc("withdraw_service_provider_claim", {
    p_claim: id.data,
  });
  if (r.error)
    return {
      error:
        "This claim could not be withdrawn. Only your pending claims can be withdrawn.",
    };
  revalidatePath("/provider/claims");
  return { success: "Claim withdrawn." };
}
