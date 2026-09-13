"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import { cents } from "@/lib/insurance/schema";
export async function insuranceAction(
  _: { error?: string; success?: string; id?: string },
  form: FormData,
): Promise<{ error?: string; success?: string; id?: string }> {
  const pet = z.uuid().safeParse(form.get("pet")),
    plan = z.union([z.uuid(), z.literal("")]).safeParse(form.get("plan") || "");
  if (!pet.success || !plan.success) return { error: "Choose valid coverage." };
  const { db } = await ownerSession();
  const action = String(form.get("action"));
  try {
    let data: unknown, error: unknown;
    const input: Record<string, unknown> = {};
    if (["plan", "term", "claim"].includes(action)) {
      const keys =
        action === "plan"
          ? [
              "coverage_kind",
              "carrier_name",
              "plan_name",
              "policy_number",
              "member_number",
              "status",
              "started_on",
              "ended_on",
              "renewal_on",
              "customer_service_phone",
              "claims_phone",
              "portal_url",
              "notes",
            ]
          : action === "term"
            ? [
                "effective_on",
                "ends_on",
                "deductible_amount_cents",
                "reimbursement_percent",
                "annual_limit_cents",
                "coverage_start_on",
                "waiting_period_notes",
                "terms_notes",
              ]
            : [
                "title",
                "claim_number",
                "service_date",
                "provider_name",
                "status",
                "submitted_on",
                "closed_on",
                "amount_submitted_cents",
                "amount_approved_cents",
                "amount_reimbursed_cents",
                "owner_out_of_pocket_cents",
                "insurer_note",
                "owner_note",
              ];
      for (const key of keys) {
        const v = String(form.get(key) || "");
        if (v.length > 2048) throw Error("A field is too long.");
        input[key] = key.endsWith("_cents") ? cents(v) : v || null;
      }
      if (action === "term")
        input.annual_limit_unlimited =
          form.get("annual_limit_unlimited") === "on";
      if (input.portal_url) {
        const u = new URL(String(input.portal_url));
        if (u.protocol !== "https:" || u.username || u.password)
          throw Error("Use an HTTPS portal link without sign-in credentials.");
        input.portal_url = u.href;
      }
      const rpc =
        action === "plan"
          ? "save_pet_coverage_plan"
          : action === "term"
            ? "add_pet_coverage_term"
            : "save_insurance_claim";
      const args: Record<string, unknown> = {
        p_pet: pet.data,
        p_plan: plan.data || null,
        p_data: input,
      };
      if (action === "claim") {
        const c = z
          .union([z.uuid(), z.literal("")])
          .parse(form.get("claim") || "");
        args.p_claim = c || null;
      }
      ({ data, error } = await db.rpc(rpc, args));
    } else if (["retire", "finalize", "link", "unlink"].includes(action)) {
      const doc = z.uuid().parse(form.get("document"));
      ({ error } = await db.rpc(
        action === "retire"
          ? "retire_coverage_document"
          : action === "finalize"
            ? "finalize_coverage_document"
            : "set_insurance_claim_document",
        action === "retire" || action === "finalize"
          ? { p_document: doc }
          : {
              p_pet: pet.data,
              p_plan: plan.data,
              p_claim: z.uuid().parse(form.get("claim")),
              p_document: doc,
              p_attached: action === "link",
            },
      ));
    } else throw Error("Invalid action.");
    if (error)
      throw Error(
        "Unable to save. Check ownership, dates, amounts and field limits.",
      );
    revalidatePath("/insurance");
    revalidatePath(`/pets/${pet.data}/insurance`, "layout");
    return {
      success: "Saved as information you recorded.",
      id: typeof data === "string" ? data : undefined,
    };
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message.length < 180
          ? e.message
          : "Unable to save this information.",
    };
  }
}
