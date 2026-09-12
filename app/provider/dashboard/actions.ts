"use server";
import { ownerSession } from "@/lib/pet-data";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  inviteInput,
  tokenSchema,
  teamRoles,
} from "@/lib/provider-dashboard/schema";
export type TeamResult = { error?: string; success?: string; token?: string };
export async function manageTeam(
  _: TeamResult,
  form: FormData,
): Promise<TeamResult> {
  const { db } = await ownerSession();
  const org = z.uuid().safeParse(form.get("organization"));
  if (!org.success) return { error: "Invalid business." };
  const operation = String(form.get("operation"));
  const args: Record<string, unknown> = { p_organization: org.data };
  let rpc: string;
  if (operation === "invite") {
    const parsed = inviteInput.safeParse({
      email: form.get("email"),
      role: form.get("role"),
      scope: form.get("scope"),
      locations: form.getAll("locations"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    rpc = "create_service_provider_invitation";
    Object.assign(args, {
      p_email: parsed.data.email,
      p_role: parsed.data.role,
      p_scope: parsed.data.scope,
      p_locations: parsed.data.locations,
    });
  } else {
    const target = z.uuid().safeParse(form.get("target"));
    if (!target.success) return { error: "Invalid team item." };
    if (operation === "revoke") {
      if (form.get("confirm") !== "yes")
        return { error: "Confirm invitation revocation." };
      rpc = "revoke_service_provider_invitation";
      args.p_invitation = target.data;
    } else {
      args.p_member = target.data;
      if (operation === "role") {
        const role = z.enum(teamRoles).safeParse(form.get("role"));
        if (!role.success) return { error: "Choose a valid role." };
        rpc = "update_service_provider_member_role";
        args.p_role = role.data;
      } else if (operation === "locations") {
        const scope = z.enum(["all", "selected"]).safeParse(form.get("scope")),
          locations = z
            .array(z.uuid())
            .max(100)
            .safeParse(form.getAll("locations"));
        if (!scope.success || !locations.success)
          return { error: "Choose valid location access." };
        rpc = "set_service_provider_member_locations";
        args.p_scope = scope.data;
        args.p_locations = locations.data;
      } else if (operation === "deactivate") {
        if (form.get("confirm") !== "yes")
          return { error: "Confirm member removal." };
        rpc = "deactivate_service_provider_member";
      } else return { error: "Invalid team action." };
    }
  }
  const r = await db.rpc(rpc, args);
  if (r.error)
    return {
      error:
        operation === "invite"
          ? "Invitation could not be created. Check your permissions, location selection and pending invitations, or try again later."
          : "This change is unavailable. Refresh and check your permissions and the member or invitation status.",
    };
  revalidatePath("/provider/dashboard");
  revalidatePath("/provider/businesses", "layout");
  return operation === "invite"
    ? {
        success:
          "Invitation created. Copy the link now; it cannot be retrieved later.",
        token: r.data.token,
      }
    : { success: "Team updated." };
}
export async function acceptBusinessInvitation(
  _: TeamResult,
  form: FormData,
): Promise<TeamResult> {
  const { db } = await ownerSession();
  const token = tokenSchema.safeParse(form.get("token"));
  if (!token.success || form.get("confirm") !== "yes")
    return { error: "Confirm that you want to join this business." };
  const r = await db.rpc("accept_service_provider_invitation", {
    p_token: token.data,
  });
  if (r.error)
    return {
      error:
        r.error.message === "You already belong to this business"
          ? "You already belong to this business."
          : "This invitation is unavailable. Check that you are signed in with the invited, confirmed email address. It may have expired or been revoked.",
    };
  revalidatePath("/provider/dashboard");
  revalidatePath("/provider/businesses", "layout");
  redirect("/provider/dashboard");
}
