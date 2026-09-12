import { ShieldCheck } from "lucide-react";
import {
  type ConnectionSummary,
  type MappingSummary,
} from "@/lib/scheduling/schema";
import { SchedulingAction } from "./actions";
import { ConnectionOverview } from "./presentation";
export {
  NoSchedulingConnections,
  ExternalAppointmentNotice,
} from "./presentation";
export function SchedulingStatus({
  connection: c,
  mappings = [],
}: {
  connection: ConnectionSummary;
  mappings?: MappingSummary[];
}) {
  return (
    <section className="account-card scheduling-card">
      <ConnectionOverview connection={c} />{" "}
      {c.can_manage && (
        <div className="scheduling-actions">
          {["active", "error"].includes(c.status) && (
            <SchedulingAction id={c.id} status="paused" label="Pause sync" />
          )}
          {c.status === "paused" && (
            <SchedulingAction id={c.id} status="active" label="Resume sync" />
          )}
          {c.status !== "revoked" && (
            <details>
              <summary>Disconnect connection</summary>
              <p>
                Stops sync for every linked household at this location. History
                remains. Reconnection requires a new authorization review.
              </p>
              <SchedulingAction
                id={c.id}
                status="revoked"
                label="Confirm disconnect"
              />
            </details>
          )}
        </div>
      )}
      {mappings.map((m) => (
        <div className="scheduling-mapping" key={m.id}>
          <ShieldCheck size={18} aria-hidden="true" />
          <h3>{m.pet_name}</h3>
          <p>
            {m.status === "pending"
              ? "Your provider has proposed a pet connection. Confirm only after checking with the provider that this is your pet’s record."
              : `Pet connection: ${m.status}`}
          </p>
          <div className="scheduling-actions">
            {m.status === "pending" && (
              <>
                <SchedulingAction
                  mapping
                  id={m.id}
                  status="confirmed"
                  label="Confirm my pet"
                />
                <SchedulingAction
                  mapping
                  id={m.id}
                  status="rejected"
                  label="Not my pet"
                />
              </>
            )}
            {m.status === "confirmed" && (
              <SchedulingAction
                mapping
                id={m.id}
                status="disconnected"
                label="Disconnect my pet"
              />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
