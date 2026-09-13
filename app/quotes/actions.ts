"use server";
import { ownerSession } from "@/lib/pet-data";
import { cents } from "@/lib/costs/schema";
import { z } from "zod";
import { revalidatePath } from "next/cache";
type Result = { error?: string; id?: string; success?: string };
export async function ecosystemAction(_: Result, f: FormData): Promise<Result> {
  const { db } = await ownerSession();
  try {
    const text = (k: string) => String(f.get(k) || "");
    const uuid = (k: string) => z.uuid().parse(text(k));
    const a = text("action");
    let name: string, args: Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (a === "request") {
      name = "submit_service_quote_request";
      args = {
        p_pet: uuid("pet"),
        p_location: uuid("location"),
        p_service: uuid("service"),
        p_note: text("owner_note"),
      };
    } else if (a === "send") {
      name = "send_service_quote";
      for (const k of [
        "amount_type",
        "amount_cents",
        "minimum_amount_cents",
        "maximum_amount_cents",
        "valid_until",
        "provider_note",
      ])
        data[k] = k.endsWith("_cents") ? cents(text(k)) : text(k) || null;
      args = { p_org: uuid("org"), p_request: uuid("request"), p_data: data };
    } else if (a === "declined" || a === "withdrawn") {
      name = "close_service_quote";
      args = { p_org: uuid("org"), p_request: uuid("request"), p_action: a };
    } else if (a === "withdraw") {
      name = "withdraw_service_quote_request";
      args = { p_pet: uuid("pet"), p_request: uuid("request") };
    } else if (a === "planning" || a === "update_planning") {
      if (text("confirm") !== "on")
        throw Error("Confirm adding or updating this quote in your planning.");
      name = "save_quote_to_planning";
      args = {
        p_pet: uuid("pet"),
        p_request: uuid("request"),
        p_year: Number(text("year")),
        p_category: text("category"),
        p_update: a === "update_planning",
      };
    } else if (a === "plan_status") {
      name = "set_quote_planning_status";
      args = {
        p_pet: uuid("pet"),
        p_planned: uuid("planned"),
        p_status: text("status"),
      };
    } else if (a === "setting") {
      name = "set_service_quote_requests";
      args = {
        p_org: uuid("org"),
        p_location: uuid("location"),
        p_service: uuid("service"),
        p_enabled: text("enabled") === "on",
      };
    } else if (a === "offer") {
      name = "save_service_provider_offer";
      for (const k of [
        "title",
        "description",
        "offer_type",
        "value_text",
        "terms",
        "starts_on",
        "ends_on",
        "status",
      ])
        data[k] = text(k) || null;
      args = {
        p_org: uuid("org"),
        p_location: text("location") ? uuid("location") : null,
        p_offer: text("offer") ? uuid("offer") : null,
        p_data: data,
      };
    } else if (a === "response") {
      name = "save_service_review_response";
      args = {
        p_org: uuid("org"),
        p_location: uuid("location"),
        p_review: uuid("review"),
        p_body: text("body"),
        p_status: text("status"),
      };
    } else if (a === "report") {
      name = "report_service_review_response";
      args = {
        p_response: uuid("response"),
        p_reason: text("reason"),
        p_details: text("details"),
      };
    } else throw Error("Invalid action.");
    const { data: result, error } = await db.rpc(name, args);
    if (error)
      throw Error(
        "Unable to save. Check permissions, current status, amounts and field limits.",
      );
    revalidatePath("/quotes");
    if (text("pet")) revalidatePath(`/pets/${uuid("pet")}`, "layout");
    if (text("org"))
      revalidatePath(`/provider/businesses/${uuid("org")}`, "layout");
    return {
      id: typeof result === "string" ? result : undefined,
      success: "Saved. Refresh the view to see its current state.",
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
