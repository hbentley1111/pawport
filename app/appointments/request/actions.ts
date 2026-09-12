"use server";
import { ownerSession } from "@/lib/pet-data";
import {
  requestInput,
  normalizeWindows,
  type Intake,
  type RequestItem,
} from "@/lib/appointment-requests/schema";
import { wallTimeToISO } from "@/lib/care/time";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export type RequestResult = { error?: string; success?: string };
export async function sendRequest(
  _: RequestResult,
  form: FormData,
): Promise<RequestResult> {
  const { db } = await ownerSession();
  const parsed = requestInput.safeParse({
    pet: form.get("pet"),
    location: form.get("location"),
    service: form.get("service"),
    contactName: form.get("contactName"),
    phone: form.get("phone"),
    note: form.get("note"),
    windows: [0, 1, 2]
      .filter((i) => form.get(`start${i}`))
      .map((i) => ({ start: form.get(`start${i}`), end: form.get(`end${i}`) })),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (form.get("consent") !== "yes")
    return {
      error: "Confirm the information you are sharing with the business.",
    };
  const p = parsed.data;
  const intake = await db.rpc("service_provider_request_intake", {
    p_location: p.location,
  });
  if (intake.error || !intake.data)
    return { error: "This business is not accepting requests right now." };
  let windows;
  try {
    windows = normalizeWindows(p.windows, (intake.data as Intake).timeZone);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Choose valid times." };
  }
  const r = await db.rpc("submit_appointment_request", {
    p_pet: p.pet,
    p_location: p.location,
    p_service: p.service,
    p_contact_name: p.contactName,
    p_phone: p.phone,
    p_note: p.note,
    p_windows: windows,
  });
  if (r.error) return { error: r.error.message };
  revalidatePath("/appointments/requests");
  redirect(`/appointments/requests/${r.data}`);
}
export async function respondToRequest(
  _: RequestResult,
  form: FormData,
): Promise<RequestResult> {
  const { db } = await ownerSession();
  const id = z.uuid().safeParse(form.get("request"));
  if (!id.success) return { error: "Invalid request." };
  const action = z
    .enum([
      "confirm",
      "propose",
      "decline",
      "provider_cancel",
      "accept",
      "reject_proposal",
      "withdraw",
      "owner_cancel",
    ])
    .safeParse(form.get("operation"));
  if (!action.success) return { error: "Invalid action." };
  const a = action.data;
  const provider = [
    "confirm",
    "propose",
    "decline",
    "provider_cancel",
  ].includes(a);
  let org: string | undefined;
  if (provider) {
    const v = z.uuid().safeParse(form.get("organization"));
    if (!v.success) return { error: "Invalid business." };
    org = v.data;
  }
  const detail = provider
    ? await db.rpc("service_provider_appointment_request", {
        p_organization: org,
        p_request: id.data,
      })
    : await db.rpc("my_appointment_request", { p_request: id.data });
  if (detail.error || !detail.data) return { error: "Request unavailable." };
  const data = detail.data as RequestItem;
  const args: Record<string, unknown> = { p_request: id.data };
  if (["confirm", "propose"].includes(a))
    try {
      args.p_start = wallTimeToISO(String(form.get("start")), data.timeZone);
      args.p_end = wallTimeToISO(String(form.get("end")), data.timeZone);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Choose valid times." };
    }
  if (["propose", "decline", "provider_cancel"].includes(a)) {
    const message = z
      .string()
      .trim()
      .max(500)
      .safeParse(form.get("message") || "");
    if (!message.success)
      return { error: "Keep your message under 500 characters." };
    args.p_message = message.data;
  }
  if (["accept", "reject_proposal"].includes(a)) {
    const proposal = z.uuid().safeParse(form.get("proposal"));
    if (!proposal.success) return { error: "Invalid proposal." };
    args.p_proposal = proposal.data;
  }
  if (
    ["withdraw", "owner_cancel", "provider_cancel", "decline"].includes(a) &&
    form.get("confirm") !== "yes"
  )
    return { error: "Confirm this action to continue." };
  const names = {
    confirm: "confirm_appointment_request",
    propose: "propose_appointment_request_time",
    decline: "decline_appointment_request",
    provider_cancel: "cancel_requested_appointment_by_provider",
    accept: "accept_appointment_request_proposal",
    reject_proposal: "decline_appointment_request_proposal",
    withdraw: "withdraw_appointment_request",
    owner_cancel: "cancel_requested_appointment_by_owner",
  };
  const result = await db.rpc(names[a], args);
  if (result.error) return { error: result.error.message };
  for (const path of [
    "/",
    "/appointments",
    "/appointments/requests",
    "/notifications",
    "/provider/dashboard",
  ])
    revalidatePath(path);
  revalidatePath(`/appointments/requests/${id.data}`);
  if (org) revalidatePath(`/provider/businesses/${org}/requests`, "layout");
  return { success: "Request updated." };
}
export async function saveRequestSettings(
  _: RequestResult,
  form: FormData,
): Promise<RequestResult> {
  const { db } = await ownerSession();
  const org = z.uuid().safeParse(form.get("organization")),
    loc = z.uuid().safeParse(form.get("location"));
  if (!org.success || !loc.success) return { error: "Invalid location." };
  const args = { p_organization: org.data, p_location: loc.data };
  let r;
  if (form.get("operation") === "service") {
    const service = z.uuid().safeParse(form.get("service"));
    if (!service.success) return { error: "Invalid service." };
    r = await db.rpc("set_service_provider_service_requestable", {
      ...args,
      p_service: service.data,
      p_enabled: form.get("enabled") === "yes",
    });
  } else {
    const fields = z
      .object({
        requests_enabled: z.boolean(),
        instructions: z.string().max(1000),
        minimum_notice_hours: z.coerce.number().int().min(0).max(336),
        maximum_advance_days: z.coerce.number().int().min(1).max(180),
      })
      .safeParse({
        requests_enabled: form.get("enabled") === "yes",
        instructions: form.get("instructions") || "",
        minimum_notice_hours: form.get("notice"),
        maximum_advance_days: form.get("advance"),
      });
    if (!fields.success) return { error: fields.error.issues[0].message };
    r = await db.rpc("save_service_provider_request_settings", {
      ...args,
      p_data: fields.data,
    });
  }
  if (r.error) return { error: r.error.message };
  revalidatePath(`/provider/businesses/${org.data}/requests`);
  revalidatePath(`/providers/${loc.data}`);
  return { success: "Request settings saved." };
}
