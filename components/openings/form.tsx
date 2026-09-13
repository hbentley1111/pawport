"use client";
import { useActionState, useState } from "react";
import { saveWatch } from "@/app/openings/actions";
import { useLocalZone, useCareHydrated } from "@/components/care/local-time";
import { localDateTime } from "@/lib/care/time";
import { OpeningSubmit } from "./actions";
import type { WatchSummary } from "@/lib/openings/schema";
export function WatchForm(props: {
  appointmentId: string;
  startsAt: string;
  watch?: WatchSummary;
}) {
  const localZone = useLocalZone(),
    ready = useCareHydrated();
  if (!ready) return <p role="status">Preparing local preferences…</p>;
  return <Editor {...props} zone={props.watch?.time_zone || localZone} />;
}
function Editor({
  appointmentId,
  startsAt,
  watch: w,
  zone,
}: {
  appointmentId: string;
  startsAt: string;
  watch?: WatchSummary;
  zone: string;
}) {
  const [state, action] = useActionState(saveWatch, {}),
    [days, setDays] = useState(w?.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6]),
    [from, setFrom] = useState(w?.earliest_time?.slice(0, 5) || ""),
    [to, setTo] = useState(w?.latest_time?.slice(0, 5) || "");
  const today = localDateTime(new Date().getTime(), zone).slice(0, 10),
    max = localDateTime(new Date().getTime() + 90 * 86400000, zone).slice(
      0,
      10,
    ),
    appointmentDay = localDateTime(startsAt, zone).slice(0, 10);
  return (
    <form action={action} className="care-form opening-form">
      <input type="hidden" name="id" value={w?.id || ""} />
      <input type="hidden" name="appointment_id" value={appointmentId} />
      <input type="hidden" name="time_zone" value={zone} />
      <p className="fine-print">
        Preferences use {zone}. Only times earlier than your appointment can
        match. A watch lasts up to 90 days.
      </p>
      <div className="care-form-grid">
        <label className="field">
          <span>From date</span>
          <input
            type="date"
            name="earliest_date"
            required
            min={today}
            max={max}
            defaultValue={w?.earliest_date || today}
          />
        </label>
        <label className="field">
          <span>Through date</span>
          <input
            type="date"
            name="latest_date"
            required
            min={today}
            max={max}
            defaultValue={
              w?.latest_date || (appointmentDay < max ? appointmentDay : max)
            }
          />
        </label>
      </div>
      <fieldset>
        <legend>Preferred days</legend>
        <div className="opening-presets">
          {[
            ["Any day", [0, 1, 2, 3, 4, 5, 6]],
            ["Weekdays", [1, 2, 3, 4, 5]],
            ["Weekends", [0, 6]],
          ].map(([label, values]) => (
            <button
              type="button"
              key={String(label)}
              className="button secondary small"
              onClick={() => setDays(values as number[])}
            >
              {String(label)}
            </button>
          ))}
        </div>
        <div className="opening-days">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                name="allowed_weekdays"
                value={i}
                checked={days.includes(i)}
                onChange={(e) =>
                  setDays(
                    e.target.checked
                      ? [...days, i]
                      : days.filter((x) => x !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Preferred start time</legend>
        <div className="opening-presets">
          {[
            ["Any time", "", ""],
            ["Morning", "06:00", "11:59"],
            ["Afternoon", "12:00", "16:59"],
            ["Evening", "17:00", "23:59"],
          ].map(([label, a, b]) => (
            <button
              type="button"
              key={label}
              className="button secondary small"
              onClick={() => {
                setFrom(a);
                setTo(b);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="care-form-grid">
          <label className="field">
            <span>Earliest time (optional)</span>
            <input
              name="earliest_time"
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Latest time (optional)</span>
            <input
              name="latest_time"
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <p className="privacy-note">
        Openings can change quickly. PetThread does not reserve or book
        appointments. Notifications appear in PetThread only; no email or push
        is sent.
      </p>
      {state.error && (
        <p role="alert" className="feedback error">
          {state.error}
        </p>
      )}
      <OpeningSubmit>
        {w ? "Save watch" : "Watch for an earlier opening"}
      </OpeningSubmit>
    </form>
  );
}
