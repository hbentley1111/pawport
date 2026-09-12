import Link from "next/link";
import { Building2, Users, MapPin, ArrowUpRight } from "lucide-react";
import {
  roleLabel,
  canManageTeam,
  auditLabel,
  type DashboardLocation,
  type DashboardOrganization,
  type BusinessAudit,
} from "@/lib/provider-dashboard/schema";
export function LocationCard({
  location: l,
  organization: o,
}: {
  location: DashboardLocation;
  organization: DashboardOrganization;
}) {
  const demo = l.scheduling.system === "mock";
  return (
    <article className="business-panel provider-location">
      <div className="provider-location-title">
        <MapPin size={21} aria-hidden />
        <h2>{l.displayName}</h2>
      </div>
      <dl className="provider-status">
        <div>
          <dt>Profile</dt>
          <dd>{l.profileStatus}</dd>
        </div>
        <div>
          <dt>Scheduling</dt>
          <dd>
            {demo ? "Demo connection · " : ""}
            {l.scheduling.status === "active"
              ? "Connected"
              : l.scheduling.status.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt>Smart Openings</dt>
          <dd>
            {l.scheduling.availabilitySupported
              ? demo
                ? "Demo capability only"
                : "Supported"
              : "Not available"}
          </dd>
        </div>
      </dl>
      {l.scheduling.lastSuccessfulSyncAt && (
        <p className="fine-print">
          Last successful sync:{" "}
          {new Date(l.scheduling.lastSuccessfulSyncAt).toLocaleString("en-US", {
            timeZone: "UTC",
          })}{" "}
          UTC
        </p>
      )}
      {l.scheduling.hasError && (
        <p className="fine-print">
          Connection needs attention. Integration management is separate.
        </p>
      )}
      <div className="provider-actions">
        <Link
          href={`/provider/businesses/${o.id}/live-booking?location=${l.id}`}
        >
          Live booking status
        </Link>
        <Link
          className="button secondary"
          href={`/provider/businesses/${o.id}/requests?location=${l.id}`}
        >
          Appointment requests
          {(l.newRequestCount || 0) > 0 ? ` · ${l.newRequestCount} new` : ""}
          {(l.awaitingOwnerCount || 0) > 0
            ? ` · ${l.awaitingOwnerCount} awaiting owner`
            : ""}
        </Link>
        <Link
          className="button secondary"
          href={`/provider/businesses/${o.id}/locations/${l.id}`}
        >
          {canManageTeam(o.role) ? "Manage profile" : "View business"}
        </Link>
        {l.publicProfileUrl && (
          <Link href={l.publicProfileUrl}>
            Public profile <ArrowUpRight size={15} aria-hidden />
          </Link>
        )}
        <Link href={`/services/${encodeURIComponent(l.googlePlaceId)}`}>
          Local Services listing
        </Link>
      </div>
      <p className="fine-print">
        Read-only connection status. No customer, pet, appointment or watch
        information is shared here.
      </p>
    </article>
  );
}
export function DashboardSummary({
  organization: o,
}: {
  organization: DashboardOrganization;
}) {
  return (
    <header className="business-heading">
      <p className="eyebrow">PAWPORT FOR BUSINESS</p>
      <h1>{o.name}</h1>
      <p>
        {roleLabel(o.role)} ·{" "}
        {o.locationScope === "all" ? "All locations" : "Assigned locations"}
      </p>
      {o.status !== "active" ? (
        <p>
          This business is suspended. Team and location actions are unavailable.
        </p>
      ) : (
        <>
          <div className="provider-summary">
            <span>
              <Building2 size={18} aria-hidden />
              {o.locations.length} accessible{" "}
              {o.locations.length === 1 ? "location" : "locations"}
            </span>
            <span>
              {
                o.locations.filter((l) => l.profileStatus === "published")
                  .length
              }{" "}
              published{" "}
              {o.locations.filter((l) => l.profileStatus === "published")
                .length === 1
                ? "profile"
                : "profiles"}
            </span>
            <span>
              {o.locations.filter((l) => l.profileStatus === "draft").length}{" "}
              draft{" "}
              {o.locations.filter((l) => l.profileStatus === "draft").length ===
              1
                ? "profile"
                : "profiles"}
            </span>
            {o.teamSummary && (
              <span>
                <Users size={18} aria-hidden />
                {o.teamSummary.activeMembers} active members ·{" "}
                {o.teamSummary.pendingInvitations} pending invitations
              </span>
            )}
          </div>
          <div className="provider-actions">
            {canManageTeam(o.role) && (
              <>
                <Link
                  className="button secondary"
                  href={`/provider/businesses/${o.id}`}
                >
                  Manage profile
                </Link>
                <Link
                  className="button secondary"
                  href={`/provider/businesses/${o.id}/team`}
                >
                  Manage team
                </Link>
              </>
            )}
            <Link href="/provider/claims">My claim history</Link>
          </div>
        </>
      )}
    </header>
  );
}
export function BusinessActivity({ events }: { events: BusinessAudit[] }) {
  return (
    <section className="business-panel">
      <h2>Business activity</h2>
      {events.length ? (
        <ol className="provider-audit">
          {events.map((e) => (
            <li key={e.id}>
              <time dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                  month: "short",
                  day: "numeric",
                })}
              </time>
              <p>
                {e.actorEmail || "Team administrator"} {auditLabel(e.eventType)}
                {e.eventType !== "invitation_accepted" && e.targetEmail
                  ? ` ${e.targetEmail}`
                  : ""}
                {e.role ? ` · ${roleLabel(e.role)}` : ""}
                {e.scope
                  ? ` · ${e.scope === "all" ? "All locations" : "Selected locations"}`
                  : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p>No team activity yet.</p>
      )}
      <p className="fine-print">
        Most recent 100 events. Visible only to business owners and admins.
      </p>
    </section>
  );
}
