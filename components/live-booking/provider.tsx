"use client";
import { useActionState, useState } from "react";
import { liveAction, liveError } from "@/lib/live-booking/client";
import { saveBinding } from "@/app/provider/businesses/[organizationId]/live-booking/actions";
import type { Catalog } from "../../supabase/functions/_shared/live-booking/contract";
export type Configuration = {
  locationId: string;
  connections: {
    id: string | null;
    system: string;
    status: string;
    availabilitySupported: boolean;
    bookingSupported: boolean;
    validatedAt: string | null;
    timeZone: string | null;
    hasError: boolean;
    canConfigure: boolean;
    servicesEnabled: number;
  }[];
  services: {
    id: string;
    name: string;
    binding: null | {
      connectionId: string;
      appointmentTypeId: string;
      durationMinutes: number;
      enabled: boolean;
      status: string;
      resources: string[];
    };
  }[];
};
function ServiceBinding({
  org,
  location,
  connection,
  service,
  catalog,
}: {
  org: string;
  location: string;
  connection: string;
  service: Configuration["services"][number];
  catalog: Catalog;
}) {
  const [state, action, pending] = useActionState(saveBinding, {});
  const b = service.binding;
  return (
    <form action={action} className="business-panel business-form">
      <h3>{service.name}</h3>
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="location" value={location} />
      <input type="hidden" name="service" value={service.id} />
      <input type="hidden" name="connection" value={connection} />
      <label>
        Appointment type
        <select name="type" defaultValue={b?.appointmentTypeId || ""} required>
          <option value="">Select appointment type</option>
          {catalog.appointmentTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Duration in minutes
        <input
          name="duration"
          type="number"
          min="10"
          max="360"
          step="5"
          required
          defaultValue={b?.durationMinutes || 30}
        />
      </label>
      <fieldset>
        <legend>Allowed calendar resources</legend>
        {catalog.resources.map((r) => (
          <label className="business-check" key={r.id}>
            <input
              type="checkbox"
              name="resources"
              value={r.id}
              defaultChecked={b?.resources?.includes(r.id)}
            />
            {r.name}
          </label>
        ))}
      </fieldset>
      <label className="business-check">
        <input type="checkbox" name="enabled" defaultChecked={b?.enabled} />
        Enable this service for sandbox live booking
      </label>
      <p>
        Service enablement does not grant booking capability or integration
        permission.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.success && <p role="status">{state.success}</p>}
      <button className="button" disabled={pending}>
        Save service mapping
      </button>
    </form>
  );
}
export function LiveConfiguration({
  org,
  data,
}: {
  org: string;
  data: Configuration;
}) {
  const [catalog, setCatalog] = useState<
      (Catalog & { timeZoneMismatch: boolean }) | null
    >(null),
    [connection, setConnection] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function load(id: string) {
    setPending(true);
    setError("");
    setCatalog(null);
    try {
      setCatalog(
        await liveAction<Catalog & { timeZoneMismatch: boolean }>({
          action: "provider_catalog",
          organizationId: org,
          locationId: data.locationId,
          connectionId: id,
        }),
      );
      setConnection(id);
    } catch (e) {
      setError(liveError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section>
      <p>Sandbox only. Production direct booking is disabled.</p>
      {!data.connections.length && (
        <p>
          No ezyVet connection is configured. Appointment requests remain
          separate.
        </p>
      )}
      {data.connections.map((c, i) => (
        <section className="business-panel" key={c.id || i}>
          <h2>ezyVet</h2>
          <p>Connection: {c.status}</p>
          <p>
            Availability capability:{" "}
            {c.availabilitySupported ? "Supported" : "Not enabled"}
          </p>
          <p>
            Direct booking capability:{" "}
            {c.bookingSupported
              ? "Operator approved for testing"
              : "Not enabled"}
          </p>
          <p>{c.servicesEnabled} services enabled</p>
          {c.hasError && <p>Connection needs attention.</p>}
          {c.timeZone && <p>Vendor timezone: {c.timeZone}</p>}
          {c.canConfigure && c.id ? (
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => load(c.id!)}
            >
              {pending ? "Validating…" : "Validate and load sandbox catalog"}
            </button>
          ) : (
            <p>
              Read-only status. Explicit scheduling permission is required to
              configure live booking.
            </p>
          )}
        </section>
      ))}
      {error && <p role="alert">{error}</p>}
      {catalog && (
        <>
          <p>Vendor-local timezone: {catalog.site.timeZone}</p>
          {catalog.timeZoneMismatch && (
            <p role="status">
              The vendor timezone differs from the Pawport location profile.
              Booking uses the vendor timezone; review the profile
              configuration.
            </p>
          )}
          {data.services
            .filter((s) => !s.binding || s.binding.connectionId === connection)
            .map((s) => (
              <ServiceBinding
                key={s.id}
                org={org}
                location={data.locationId}
                connection={connection}
                service={s}
                catalog={catalog}
              />
            ))}
        </>
      )}
    </section>
  );
}
