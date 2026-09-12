import Link from "next/link";
import { careDate, careTime } from "@/lib/care/time";
import {
  requestLabel,
  type RequestItem,
} from "@/lib/appointment-requests/schema";
export function RequestTime({
  start,
  end,
  zone,
}: {
  start: string;
  end: string;
  zone: string;
}) {
  return (
    <span>
      {careDate(start, zone)} · {careTime(start, zone)} – {careTime(end, zone)}
    </span>
  );
}
export function RequestCTA({ location }: { location: string }) {
  return (
    <section className="business-panel">
      <h2>Arrange your next visit</h2>
      <p>
        The business will confirm or suggest another time. Nothing is booked
        until the appointment is confirmed.
      </p>
      <Link
        className="button"
        href={`/appointments/request?locationId=${location}`}
      >
        Request appointment
      </Link>
    </section>
  );
}
export function RequestList({
  items,
  base,
}: {
  items: RequestItem[];
  base: string;
}) {
  return (
    <div className="provider-location-grid">
      {!items.length && (
        <section className="business-panel">
          <h2>No appointment requests yet.</h2>
          <p>Requests and responses will appear here.</p>
        </section>
      )}
      {items.map((r) => (
        <article key={r.requestId} className="business-panel">
          <p className="eyebrow">{requestLabel(r.status)}</p>
          <h2>
            {r.petName} · {r.serviceName}
          </h2>
          <p>{r.businessName}</p>
          <p>{r.locationName}</p>
          <p>Submitted {careDate(r.createdAt, r.timeZone)}</p>
          <Link className="button secondary" href={`${base}/${r.requestId}`}>
            View request
          </Link>
        </article>
      ))}
    </div>
  );
}
export function RequestDetails({ item: r }: { item: RequestItem }) {
  return (
    <>
      <header className="business-heading">
        <p className="eyebrow">{requestLabel(r.status)}</p>
        <h1>{r.serviceName}</h1>
        <p>
          {r.petName}
          {r.species ? ` · ${r.species}` : ""} · {r.businessName}
        </p>
        <p>
          {r.locationName} · Times in {r.timeZone}
        </p>
      </header>
      <section className="business-panel">
        <h2>Preferred times</h2>
        {r.preferredWindows.map((w, i) => (
          <p key={i}>
            <RequestTime start={w.startsAt} end={w.endsAt} zone={r.timeZone} />
          </p>
        ))}
        <p>Request expires {careDate(r.expiresAt, r.timeZone)}</p>
      </section>
      {r.contactName && (
        <section className="business-panel">
          <h2>Contact shared for this request</h2>
          <p>{r.contactName}</p>
          <p>{r.contactEmail}</p>
          <p>{r.contactPhone}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.note}</p>
        </section>
      )}
      {r.proposal && (
        <section className="business-panel">
          <h2>Business proposed a time</h2>
          <p>
            <RequestTime
              start={r.proposal.startsAt}
              end={r.proposal.endsAt}
              zone={r.timeZone}
            />
          </p>
          <p>{r.proposal.message}</p>
          <p>
            {r.proposal.status} · expires{" "}
            {careDate(r.proposal.expiresAt, r.timeZone)}
          </p>
        </section>
      )}
      {r.responseNote && (
        <section className="business-panel">
          <h2>Business response</h2>
          <p>{r.responseNote}</p>
        </section>
      )}
      {r.appointmentId && (
        <p>
          <Link className="button" href={`/appointments/${r.appointmentId}`}>
            View appointment
          </Link>
        </p>
      )}
      {r.appointment && (
        <section className="business-panel">
          <h2>Appointment · {r.appointment.status}</h2>
          <RequestTime
            start={r.appointment.startsAt}
            end={r.appointment.endsAt}
            zone={r.timeZone}
          />
        </section>
      )}
      <section className="business-panel">
        <h2>Request history</h2>
        <ol className="provider-audit">
          {r.history.map((e) => (
            <li key={e.id}>
              <strong>{e.type.replaceAll("_", " ")}</strong>
              <p>{careDate(e.createdAt, r.timeZone)}</p>
              {e.message && <p>{e.message}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
