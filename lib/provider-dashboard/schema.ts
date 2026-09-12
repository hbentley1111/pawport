import { z } from "zod";
export const teamRoles = ["admin", "staff", "scheduling_manager"] as const;
export type TeamRole = "owner" | (typeof teamRoles)[number];
export const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const roleLabel = (role: string) =>
  ({
    owner: "Owner",
    admin: "Admin",
    staff: "Staff",
    scheduling_manager: "Scheduling manager",
  })[role] || "Member";
export const canManageTeam = (role: TeamRole) =>
  role === "owner" || role === "admin";
export const assignableRoles = (role: TeamRole) =>
  role === "owner"
    ? teamRoles
    : role === "admin"
      ? (["staff", "scheduling_manager"] as const)
      : [];
export const canChangeMember = (actor: TeamRole, target: TeamMember) =>
  target.active &&
  !target.isSelf &&
  target.role !== "owner" &&
  (actor === "owner" || (actor === "admin" && target.role !== "admin"));
export const inviteInput = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email(),
    role: z.enum(teamRoles),
    scope: z.enum(["all", "selected"]),
    locations: z.array(z.uuid()).max(100),
  })
  .strict()
  .refine(
    (v) =>
      v.scope === "all"
        ? v.locations.length === 0
        : v.role !== "admin" && v.locations.length > 0,
    "Select locations for this role, or choose all locations.",
  );
export type SchedulingSummary = {
  connected: boolean;
  status: string;
  system: string | null;
  availabilitySupported: boolean;
  lastSuccessfulSyncAt: string | null;
  hasError: boolean;
};
export type DashboardLocation = {
  id: string;
  displayName: string;
  profileStatus: string;
  publicProfileUrl: string | null;
  googlePlaceId: string;
  scheduling: SchedulingSummary;
  newRequestCount?: number;
  awaitingOwnerCount?: number;
};
export type DashboardOrganization = {
  id: string;
  name: string;
  status: string;
  role: TeamRole;
  locationScope: "all" | "selected";
  locations: DashboardLocation[];
  teamSummary: { activeMembers: number; pendingInvitations: number } | null;
};
export type TeamMember = {
  membershipId: string;
  displayEmail: string | null;
  role: TeamRole;
  active: boolean;
  locationScope: "all" | "selected";
  locations: string[];
  isSelf: boolean;
  joinedAt: string;
};
export type TeamInvitation = {
  id: string;
  email: string;
  role: Exclude<TeamRole, "owner">;
  locationScope: "all" | "selected";
  expiresAt: string;
};
export type Team = {
  organizationName: string;
  role: TeamRole;
  members: TeamMember[];
  invitations: TeamInvitation[];
  locations: { id: string; name: string }[];
};
export type InvitationPreview = {
  organizationName: string;
  role: TeamRole;
  locationScope: string;
  locations: string[];
  expiresAt: string;
};
export type BusinessAudit = {
  id: string;
  eventType: string;
  actorEmail: string | null;
  targetEmail: string | null;
  role: string | null;
  scope: string | null;
  createdAt: string;
};
export const auditLabel = (type: string) =>
  ({
    invitation_created: "invited",
    invitation_revoked: "revoked an invitation for",
    invitation_accepted: "joined the team",
    member_role_changed: "changed the role for",
    member_location_access_changed: "changed location access for",
    member_deactivated: "removed",
  })[type] || "updated the team";
