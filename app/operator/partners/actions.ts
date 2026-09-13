"use server";
import { ownerSession } from "@/lib/pet-data";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export type ActionResult = { error?: string; success?: string; id?: string };
export async function partnerAction(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const { db } = await ownerSession();
  try {
    const s = (k: string) => String(form.get(k) || ""),
      id = (k: string) => z.uuid().parse(s(k)),
      optional = (k: string) => (s(k) ? id(k) : null);
    let name: string, args: Record<string, unknown>;
    const a = s("action");
    if (a === "registry") {
      const data: Record<string, string | null> = {};
      for (const k of [
        "partner_key",
        "display_name",
        "partner_type",
        "legal_name",
        "external_reference",
        "contract_status",
        "contract_effective_on",
        "contract_expires_on",
        "technical_owner_name",
        "technical_owner_email",
        "support_email",
        "security_contact_email",
        "privacy_contact_email",
        "notes",
      ])
        data[k] = s(k) || null;
      name = "save_partner_registry";
      args = { p_partner: optional("partner"), p_data: data };
    } else if (a === "capability") {
      name = "set_partner_capability";
      args = {
        p_partner: id("partner"),
        p_key: s("capability"),
        p_environment: s("environment"),
        p_status: s("status"),
        p_expires: s("expires")
          ? new Date(s("expires") + "Z").toISOString()
          : null,
      };
    } else if (a === "connection") {
      name = "create_partner_operational_connection";
      args = {
        p_partner: id("partner"),
        p_org: optional("organization"),
        p_location: optional("location"),
        p_household: optional("household"),
        p_environment: s("environment"),
      };
    } else if (a === "credential") {
      name = "register_partner_credential";
      args = { p_connection: id("connection"), p_reference: s("reference") };
    } else if (a === "activation") {
      name = "partner_activation_action";
      args = {
        p_connection: id("connection"),
        p_action: s("operation"),
        p_reason: s("reason") || null,
      };
    } else if (a === "partner_status") {
      name = "set_partner_operational_status";
      args = { p_partner: id("partner"), p_status: s("status") };
    } else if (a === "grant") {
      name = "set_partner_data_grant";
      args = {
        p_connection: id("connection"),
        p_category: s("category"),
        p_purpose: s("purpose"),
        p_direction: s("direction"),
        p_enabled: s("enabled") === "on",
        p_expires: s("expires")
          ? new Date(s("expires") + "Z").toISOString()
          : null,
      };
    } else if (a === "bridge") {
      name = "link_partner_provider_connection";
      args = { p_connection: id("connection"), p_provider: id("provider") };
    } else if (a === "pilot") {
      const data: Record<string, string | null> = {};
      for (const k of [
        "connection_id",
        "organization_id",
        "location_id",
        "external_site_reference",
        "status",
        "consent_received_at",
        "pilot_started_at",
        "pilot_ends_at",
        "completed_at",
        "notes",
      ])
        data[k] = s(k)
          ? k.endsWith("_at")
            ? new Date(s(k) + "Z").toISOString()
            : s(k)
          : null;
      name = "save_partner_pilot";
      args = {
        p_partner: id("partner"),
        p_pilot: optional("pilot"),
        p_data: data,
      };
    } else throw Error("Invalid action");
    const { data, error } = await db.rpc(name, args);
    if (error)
      return {
        error:
          "Action unavailable. Check authorization, scope, field values and activation prerequisites.",
      };
    revalidatePath("/operator/partners", "layout");
    revalidatePath("/account/connections", "layout");
    return {
      success: "Saved.",
      id: typeof data === "string" ? data : undefined,
    };
  } catch {
    return {
      error: "Unable to save. Check the required fields and identifiers.",
    };
  }
}
