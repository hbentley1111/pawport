"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import {
  parseHoursForm,
  organizationInput,
  locationInput,
  serviceInput,
} from "@/lib/business-profiles/schema";
export type ProfileResult = { error?: string; success?: string };
export async function mutateProfile(
  _previous: ProfileResult,
  form: FormData,
): Promise<ProfileResult> {
  const { db } = await ownerSession();
  const org = z.uuid().safeParse(form.get("organization"));
  const loc = z.uuid().safeParse(form.get("location"));
  if (!org.success) return { error: "Invalid business." };
  const operation = String(form.get("operation"));
  let rpc: string;
  const args: Record<string, unknown> = { p_organization: org.data };
  const fields = (names: string[]) =>
    Object.fromEntries(names.map((n) => [n, String(form.get(n) || "")]));
  if (operation === "organization") {
    const parsed = organizationInput.safeParse(
      fields(Object.keys(organizationInput.shape)),
    );
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    rpc = "save_service_provider_organization_profile";
    args.p_data = parsed.data;
  } else {
    if (!loc.success) return { error: "Invalid location." };
    args.p_location = loc.data;
    if (operation === "location") {
      const parsed = locationInput.safeParse(
        fields(Object.keys(locationInput.shape)),
      );
      if (!parsed.success) return { error: parsed.error.issues[0].message };
      rpc = "save_service_provider_location_profile";
      args.p_data = parsed.data;
    } else if (operation === "hours") {
      try {
        const schedule = parseHoursForm(form);
        args.p_provided = schedule.provided;
        args.p_hours = schedule.hours;
      } catch {
        return { error: "Choose valid opening hours for each day." };
      }
      rpc = "replace_service_provider_location_hours";
    } else if (operation === "service") {
      const parsed = serviceInput.safeParse(
        fields(Object.keys(serviceInput.shape)),
      );
      if (!parsed.success) return { error: parsed.error.issues[0].message };
      const id = form.get("service");
      if (id && !z.uuid().safeParse(id).success)
        return { error: "Invalid service." };
      args.p_service = id || null;
      args.p_data = parsed.data;
      rpc = "save_service_provider_service";
    } else if (operation === "archive-service") {
      const id = z.uuid().safeParse(form.get("service"));
      if (!id.success) return { error: "Invalid service." };
      args.p_service = id.data;
      rpc = "archive_service_provider_service";
    } else if (operation === "publication") {
      if (form.get("confirm") !== "yes")
        return { error: "Confirm your publication choice." };
      const status = z
        .enum(["published", "unpublished"])
        .safeParse(form.get("status"));
      if (!status.success) return { error: "Invalid publication choice." };
      args.p_status = status.data;
      rpc = "set_service_provider_profile_status";
    } else return { error: "Invalid profile action." };
  }
  const r = await db.rpc(rpc, args);
  if (r.error)
    return {
      error:
        operation === "hours"
          ? "Hours could not be saved. Use up to two non-overlapping windows per day, with closing time after opening time."
          : "Could not save. Check your fields, permissions and business status, then try again.",
    };
  revalidatePath("/provider/businesses", "layout");
  revalidatePath("/providers", "layout");
  revalidatePath("/services", "layout");
  return {
    success:
      operation === "publication"
        ? args.p_status === "published"
          ? "Profile published."
          : "Profile unpublished. Your listing remains claimed."
        : "Saved.",
  };
}
