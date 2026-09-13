"use client";
import { useActionState, useState } from "react";
import {
  manageTeam,
  acceptBusinessInvitation,
  type TeamResult,
} from "@/app/provider/dashboard/actions";
import {
  roleLabel,
  assignableRoles,
  canChangeMember,
  type Team,
  type TeamMember,
  type InvitationPreview,
} from "@/lib/provider-dashboard/schema";
function TeamForm({
  org,
  operation,
  target,
  children,
  label,
}: {
  org: string;
  operation: string;
  target?: string;
  children: React.ReactNode;
  label: string;
}) {
  const [state, action, pending] = useActionState(manageTeam, {} as TeamResult);
  const [copiedToken, setCopiedToken] = useState("");
  return (
    <form action={action} className="business-form">
      <input type="hidden" name="organization" value={org} />
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="target" value={target || ""} />
      {children}
      <button className="button secondary" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      <div aria-live="polite">
        {state.error && <p role="alert">{state.error}</p>}
        {state.success && <p>{state.success}</p>}
      </div>
      {state.token && (
        <div className="provider-invite-result">
          <p>
            Share this link privately with the invited teammate. No email has
            been sent.
          </p>
          <button
            className="button"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/provider/invitations/${state.token}`,
                );
                setCopiedToken(state.token!);
              } catch {
                setCopiedToken("");
              }
            }}
          >
            Copy invitation link
          </button>
          <p role="status">
            {copiedToken === state.token
              ? "Copied. Share only with the invited teammate."
              : "The token is available only in this creation response."}
          </p>
          <details>
            <summary>Show link for manual copying</summary>
            <input
              aria-label="Invitation link"
              readOnly
              value={
                typeof window === "undefined"
                  ? ""
                  : `${window.location.origin}/provider/invitations/${state.token}`
              }
              onFocus={(e) => e.target.select()}
            />
          </details>
        </div>
      )}
    </form>
  );
}
function LocationScope({
  locations,
  initial = "all",
  selected = [],
}: {
  locations: Team["locations"];
  initial?: string;
  selected?: string[];
}) {
  const [scope, setScope] = useState(initial);
  return (
    <>
      <label>
        Location access
        <select
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All locations</option>
          <option value="selected">Selected locations</option>
        </select>
      </label>
      {scope === "selected" && (
        <fieldset className="provider-location-options">
          <legend>Choose locations</legend>
          {locations.map((l) => (
            <label className="business-check" key={l.id}>
              <input
                type="checkbox"
                name="locations"
                value={l.id}
                defaultChecked={selected.includes(l.id)}
              />
              {l.name}
            </label>
          ))}
          {!locations.length && <p>No active locations are available.</p>}
        </fieldset>
      )}
    </>
  );
}
export function InvitationForm({ org, team }: { org: string; team: Team }) {
  const [role, setRole] = useState("staff");
  return (
    <TeamForm org={org} operation="invite" label="Create invitation">
      <label>
        Teammate email
        <input
          type="email"
          name="email"
          maxLength={254}
          required
          autoComplete="off"
        />
      </label>
      <label>
        Role
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {assignableRoles(team.role).map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </label>
      {role === "admin" ? (
        <>
          <input type="hidden" name="scope" value="all" />
          <p>Admins have access to all locations.</p>
        </>
      ) : (
        <LocationScope locations={team.locations} />
      )}
      <p className="fine-print">
        The link expires after seven days. Your teammate must sign in with this
        confirmed email address. Membership does not grant veterinary or
        scheduling-integration authority.
      </p>
    </TeamForm>
  );
}
function MemberActions({
  org,
  team,
  member: m,
}: {
  org: string;
  team: Team;
  member: TeamMember;
}) {
  return (
    <details className="business-service-edit">
      <summary>Manage {m.displayEmail || "member"}</summary>
      <TeamForm
        org={org}
        operation="role"
        target={m.membershipId}
        label="Save role"
      >
        <label>
          Role
          <select name="role" defaultValue={m.role}>
            {assignableRoles(team.role).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </TeamForm>
      {["staff", "scheduling_manager"].includes(m.role) && (
        <TeamForm
          org={org}
          operation="locations"
          target={m.membershipId}
          label="Save location access"
        >
          <LocationScope
            key={`${m.locationScope}:${m.locations.join(",")}`}
            locations={team.locations}
            initial={m.locationScope}
            selected={m.locations}
          />
        </TeamForm>
      )}
      <TeamForm
        org={org}
        operation="deactivate"
        target={m.membershipId}
        label="Remove member"
      >
        <label className="business-check">
          <input type="checkbox" name="confirm" value="yes" required />
          Remove this member’s business access. Their personal PetThread account
          stays available.
        </label>
      </TeamForm>
    </details>
  );
}
export function TeamRoster({ org, team }: { org: string; team: Team }) {
  return (
    <section className="business-panel">
      <h2>Team members</h2>
      <ul className="provider-team">
        {team.members.map((m) => (
          <li key={m.membershipId}>
            <h3>
              {m.displayEmail || "PetThread member"}
              {m.isSelf ? " (you)" : ""}
            </h3>
            <p>
              {roleLabel(m.role)} · {m.active ? "Active" : "Removed"}
            </p>
            <p className="fine-print">
              {m.locationScope === "all"
                ? "All locations"
                : m.locations
                    .map(
                      (id) =>
                        team.locations.find((l) => l.id === id)?.name ||
                        "Unavailable location",
                    )
                    .join(" · ")}
            </p>
            {canChangeMember(team.role, m) && (
              <MemberActions org={org} team={team} member={m} />
            )}
          </li>
        ))}
      </ul>
      <p className="fine-print">
        Ownership transfer and self-removal are not available in this phase.
      </p>
    </section>
  );
}
export function PendingInvitations({ org, team }: { org: string; team: Team }) {
  return (
    <section className="business-panel">
      <h2>Pending invitations</h2>
      {team.invitations.length ? (
        team.invitations.map((i) => (
          <article className="provider-pending" key={i.id}>
            <h3>{i.email}</h3>
            <p>
              {roleLabel(i.role)} ·{" "}
              {i.locationScope === "all"
                ? "All locations"
                : "Selected locations"}
            </p>
            <p>
              Expires{" "}
              {new Date(i.expiresAt).toLocaleDateString("en-US", {
                timeZone: "UTC",
                month: "short",
                day: "numeric",
              })}
            </p>
            {(team.role === "owner" || i.role !== "admin") && (
              <TeamForm
                org={org}
                operation="revoke"
                target={i.id}
                label="Revoke invitation"
              >
                <label className="business-check">
                  <input type="checkbox" name="confirm" value="yes" required />
                  Invalidate this invitation link.
                </label>
              </TeamForm>
            )}
          </article>
        ))
      ) : (
        <p>No pending invitations.</p>
      )}
      <p className="fine-print">
        Lost a link? Revoke the invitation and create another. Tokens cannot be
        retrieved.
      </p>
    </section>
  );
}
export function AcceptInvitation({
  token,
  preview: p,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const [state, action, pending] = useActionState(
    acceptBusinessInvitation,
    {} as TeamResult,
  );
  return (
    <section className="business-panel">
      <h1>Join {p.organizationName}</h1>
      <p>
        {roleLabel(p.role)} ·{" "}
        {p.locationScope === "all" ? "All locations" : p.locations.join(" · ")}
      </p>
      <p>
        This invitation expires{" "}
        {new Date(p.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
        .
      </p>
      <form action={action} className="business-form">
        <input type="hidden" name="token" value={token} />
        <label className="business-check">
          <input type="checkbox" name="confirm" value="yes" required />
          Join this business with the role and location access shown above.
        </label>
        <button className="button" disabled={pending}>
          {pending ? "Joining…" : "Accept invitation"}
        </button>
        {state.error && <p role="alert">{state.error}</p>}
      </form>
      <p className="fine-print">
        Your personal pet-owner account stays separate. This does not grant
        medical verification or scheduling-integration access.
      </p>
    </section>
  );
}
