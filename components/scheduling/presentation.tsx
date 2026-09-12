import { Cable } from "lucide-react";
import { statusLabel, type ConnectionSummary } from "@/lib/scheduling/schema";
import { ConnectionTime } from "./time";
export function ConnectionOverview({
  connection: c,
}: {
  connection: ConnectionSummary;
}) {
  return (
    <>
      <Cable size={26} aria-hidden="true" />
      <p className="eyebrow">{c.connection_type} · SCHEDULING</p>
      <h2>
        {c.system === "mock"
          ? "Demo connection"
          : c.label || "Provider connection"}
      </h2>
      <p>{c.system === "mock" ? "Demo Scheduling System" : c.system}</p>
      <span
        className={`care-status ${c.status === "active" ? "confirmed" : "requested"}`}
      >
        {statusLabel(c.status)}
      </span>
      {c.system === "mock" && (
        <p className="privacy-note">
          Fictional scheduling data. No real provider is connected.
        </p>
      )}
      <dl className="scheduling-dates">
        <div>
          <dt>Last attempted sync</dt>
          <dd>
            <ConnectionTime value={c.last_sync_at} />
          </dd>
        </div>
        <div>
          <dt>Last successful sync</dt>
          <dd>
            <ConnectionTime value={c.last_success_at} />
          </dd>
        </div>
      </dl>
      {c.status === "error" && (
        <p role="status">
          Sync needs attention. {c.last_error_code?.replaceAll("_", " ")}. An
          authorized operator must validate the connection before reconnecting.
        </p>
      )}
      {c.status === "revoked" && (
        <p>
          Disconnected. Appointment history is preserved; future sync has
          stopped.
        </p>
      )}
    </>
  );
}
export function NoSchedulingConnections() {
  return (
    <section className="account-card">
      <Cable size={30} aria-hidden="true" />
      <h2>No scheduling connections yet.</h2>
      <p>
        Keep recording appointments in your care calendar. Provider integrations
        are not available yet.
      </p>
      <p className="fine-print">
        Scheduling access is granted separately from record verification. There
        is no live Connect or OAuth flow in this phase.
      </p>
    </section>
  );
}
export function ExternalAppointmentNotice({
  state,
}: {
  state?: string | null;
}) {
  return (
    <p className="privacy-note">
      Managed by your provider. Date, time, provider and status are read-only in
      Pawport.
      {state === "disconnected"
        ? " This connection is disconnected. The saved appointment remains available, but may be out of date."
        : state === "paused"
          ? " Sync is paused; this appointment may be out of date."
          : state === "attention"
            ? " Sync needs attention; confirm details with your provider."
            : ""}
    </p>
  );
}
