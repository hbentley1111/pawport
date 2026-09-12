"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  liveAction,
  liveError,
  type LiveService,
  type Quote,
} from "@/lib/live-booking/client";
export function LiveBookingLink({ locationId }: { locationId: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let current = true;
    liveAction<{ services: LiveService[] }>({ action: "intake", locationId })
      .then((r) => {
        if (current) setAvailable(r.services.length > 0);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [locationId]);
  return available ? (
    <section className="business-panel">
      <p>Sandbox live booking available</p>
      <Link
        className="button secondary"
        href={`/appointments/book?locationId=${locationId}`}
      >
        View live times
      </Link>
      <p>Testing environment. Production booking is not enabled.</p>
    </section>
  ) : null;
}
export function LiveBookingForm({
  locationId,
  serviceId,
  pets,
  fallback,
}: {
  locationId: string;
  serviceId?: string;
  pets: { id: string; name: string }[];
  fallback: boolean;
}) {
  const [services, setServices] = useState<LiveService[]>([]),
    [service, setService] = useState(serviceId || ""),
    [pet, setPet] = useState(pets[0]?.id || ""),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [selected, setSelected] = useState<Quote | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [appointment, setAppointment] = useState(""),
    [locked, setLocked] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let current = true;
    liveAction<{ services: LiveService[] }>({ action: "intake", locationId })
      .then((r) => {
        if (current) {
          setServices(r.services);
          if (!serviceId) setService(r.services[0]?.id || "");
          if (!r.services.length)
            setMessage("Live booking is unavailable for this location.");
        }
      })
      .catch((e) => {
        if (current) setMessage(liveError(e));
      });
    return () => {
      current = false;
    };
  }, [locationId, serviceId]);
  const format = (q: Quote) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: q.timeZone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(q.startsAt));
  async function load() {
    setPending(true);
    setSelected(null);
    setMessage("");
    setQuotes([]);
    try {
      const r = await liveAction<{ quotes: Quote[] }>({
        action: "availability",
        locationId,
        serviceId: service,
        petId: pet,
      });
      setQuotes(r.quotes);
      setLoaded(true);
    } catch (e) {
      setMessage(liveError(e));
    } finally {
      setPending(false);
    }
  }
  async function book() {
    if (!selected || pending || locked) return;
    setPending(true);
    setLocked(true);
    setMessage("");
    try {
      const r = await liveAction<{ appointmentId: string }>({
        action: "book",
        quoteId: selected.quoteId,
      });
      setAppointment(r.appointmentId);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (
        [
          "slot_gone",
          "unauthorized",
          "rate_limited",
          "vendor_error",
          "unavailable",
        ].includes(code)
      ) {
        setLocked(false);
        setQuotes([]);
        setSelected(null);
        setMessage(liveError(e));
      } else {
        setMessage(liveError(new Error("unknown")));
      }
    } finally {
      setPending(false);
    }
  }
  if (appointment)
    return (
      <section className="business-panel">
        <h2>Appointment confirmed.</h2>
        {selected && <p>{format(selected)}</p>}
        <Link href={`/appointments/${appointment}`}>View appointment</Link>
      </section>
    );
  return (
    <section className="business-panel business-form">
      <p className="eyebrow">ezyVet sandbox</p>
      <p>
        Production booking is disabled. These controls require an approved
        sandbox connection and an existing pet mapping.
      </p>
      <label>
        Pet
        <select
          value={pet}
          disabled={pending || locked}
          onChange={(e) => {
            setPet(e.target.value);
            setQuotes([]);
            setSelected(null);
            setLoaded(false);
          }}
        >
          {pets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Service
        <select
          value={service}
          disabled={pending || locked}
          onChange={(e) => {
            setService(e.target.value);
            setQuotes([]);
            setSelected(null);
            setLoaded(false);
          }}
        >
          <option value="">Select a service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button secondary"
        disabled={
          !pet || !services.some((s) => s.id === service) || pending || locked
        }
        onClick={load}
      >
        {pending ? "Checking…" : "Check live availability"}
      </button>
      {message && <p role="alert">{message}</p>}
      {loaded && !quotes.length && !message && (
        <p>No live times are available in the next 7 days.</p>
      )}
      {!!quotes.length && (
        <LiveSlotPicker
          quotes={quotes}
          selected={selected}
          disabled={pending || locked}
          onSelect={setSelected}
        />
      )}
      {selected && (
        <section aria-label="Review booking">
          <h2>Review booking</h2>
          <p>
            {pets.find((p) => p.id === pet)?.name} ·{" "}
            {services.find((s) => s.id === service)?.name}
          </p>
          <p>
            {format(selected)} ({selected.timeZone})
          </p>
          <p>
            Availability can change until booking is confirmed. This quote
            expires after five minutes.
          </p>
          <button
            className="button"
            disabled={pending || locked}
            onClick={book}
          >
            {pending ? "Confirming booking…" : "Confirm booking"}
          </button>
        </section>
      )}
      {fallback && !locked && (
        <Link href={`/appointments/request?locationId=${locationId}`}>
          Request appointment instead
        </Link>
      )}
    </section>
  );
}

export function LiveSlotPicker({
  quotes,
  selected,
  disabled = false,
  onSelect,
}: {
  quotes: Quote[];
  selected: Quote | null;
  disabled?: boolean;
  onSelect: (q: Quote) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>Live times — business-local time</legend>
      <div className="live-slot-grid">
        {quotes.map((q) => (
          <label key={q.quoteId}>
            <input
              type="radio"
              name="slot"
              checked={selected?.quoteId === q.quoteId}
              onChange={() => onSelect(q)}
            />
            <span>
              {new Intl.DateTimeFormat("en-US", {
                timeZone: q.timeZone,
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(q.startsAt))}
            </span>
            <small>{q.timeZone}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
