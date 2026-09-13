"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ownerSession } from "@/lib/pet-data";
import { cents } from "@/lib/costs/schema";
type Result = { error?: string; success?: string; id?: string };
export async function costAction(_: Result, form: FormData): Promise<Result> {
  const { db } = await ownerSession();
  try {
    const pet = z.uuid().parse(form.get("pet"));
    const action = String(form.get("action"));
    const id = form.get("id") ? z.uuid().parse(form.get("id")) : null;
    const input: Record<string, unknown> = {};
    let name: string, args: Record<string, unknown>;
    if (action === "expense" || action === "planned") {
      const keys =
        action === "expense"
          ? [
              "title",
              "category",
              "service_date",
              "provider_name",
              "amount_cents",
              "appointment_id",
              "coverage_plan_id",
              "notes",
            ]
          : [
              "title",
              "category",
              "planning_year",
              "planned_amount_cents",
              "due_on",
              "appointment_id",
              "care_plan_id",
              "status",
              "notes",
            ];
      for (const k of keys) {
        const v = String(form.get(k) || "");
        if (v.length > 1000) throw Error("A field is too long.");
        input[k] = k.endsWith("_cents") ? cents(v) : v || null;
      }
      name =
        action === "expense" ? "save_pet_expense" : "save_pet_planned_cost";
      args = {
        p_pet: pet,
        p_data: input,
        [action === "expense" ? "p_expense" : "p_planned"]: id,
      };
    } else if (action === "budget") {
      name = "save_pet_cost_budget";
      args = {
        p_pet: pet,
        p_year: Number(form.get("year")),
        p_category: String(form.get("category")),
        p_amount: cents(String(form.get("amount") || "")),
        p_notes: String(form.get("notes") || ""),
      };
    } else if (action === "convert") {
      if (form.get("confirmed") !== "on")
        throw Error("Confirm the amount actually paid.");
      name = "convert_planned_cost_to_expense";
      args = {
        p_pet: pet,
        p_planned: id,
        p_amount: cents(String(form.get("amount") || "")),
        p_service_date: String(form.get("service_date") || ""),
      };
    } else if (action === "allocate" || action === "unlink") {
      name = "set_expense_claim_allocation";
      args = {
        p_pet: pet,
        p_expense: id,
        p_claim: z.uuid().parse(form.get("claim")),
        p_amount:
          action === "unlink" ? null : cents(String(form.get("amount") || "")),
      };
      if (action === "allocate" && args.p_amount === null)
        throw Error("Enter the amount to allocate.");
    } else if (action === "retire" || action === "finalize") {
      name =
        action === "retire"
          ? "retire_expense_document"
          : "finalize_expense_document";
      args = { p_document: id };
    } else throw Error("Invalid action.");
    const { data, error } = await db.rpc(name, args);
    if (error)
      throw Error(
        "Unable to save. Check ownership, field limits and existing reimbursement allocations.",
      );
    revalidatePath("/costs");
    revalidatePath(`/pets/${pet}/costs`, "page");
    revalidatePath(`/pets/${pet}/costs`, "layout");
    return {
      success: "Saved as owner-entered information.",
      id: typeof data === "string" ? data : undefined,
    };
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message.length < 160
          ? e.message
          : "Unable to save this record.",
    };
  }
}
