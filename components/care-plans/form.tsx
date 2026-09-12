"use client";
import { useActionState, useState } from "react";
import { savePlan } from "@/app/care/actions";
import {
  categories,
  categoryText,
  reminderOffsets,
  reminderText,
  type CarePlan,
} from "@/lib/care-plans/schema";
import { useLocalZone } from "../care/local-time";
export function PlanForm({
  pets,
  plan,
  selectedPet,
}: {
  pets: { id: string; name: string }[];
  plan?: CarePlan;
  selectedPet?: string;
}) {
  const [state, submit, pending] = useActionState(savePlan, {}),
    [repeat, setRepeat] = useState(plan?.recurrence_type || "interval");
  const browserZone = useLocalZone();
  return (
    <form action={submit} className="care-form routine-form">
      <input type="hidden" name="id" value={plan?.id || ""} />
      <p className="routine-provenance">
        Owner-entered care schedule · separate from veterinarian-verified
        records.
      </p>
      <label className="field">
        <span>Pet</span>
        {plan ? (
          <>
            <input value={plan.pet_name} readOnly />
            <input type="hidden" name="pet_id" value={plan.pet_id} />
          </>
        ) : (
          <select
            required
            name="pet_id"
            defaultValue={selectedPet || pets[0]?.id}
          >
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="field">
        <span>Title</span>
        <input
          required
          name="title"
          maxLength={120}
          defaultValue={plan?.title}
        />
      </label>
      <label className="field">
        <span>Category</span>
        <select name="category" defaultValue={plan?.category || "custom"}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {categoryText(c)}
            </option>
          ))}
        </select>
      </label>
      <div className="routine-grid two">
        <label className="field">
          <span>{plan ? "Future schedule starts" : "First due date"}</span>
          <input
            required
            type="date"
            name="anchor_local_date"
            min="1900-01-01"
            max="2199-12-31"
            defaultValue={plan?.anchor_local_date}
          />
        </label>
        <label className="field">
          <span>Time (optional)</span>
          <input
            type="time"
            name="anchor_local_time"
            defaultValue={plan?.anchor_local_time?.slice(0, 5)}
          />
        </label>
      </div>
      <label className="field">
        <span>Time zone</span>
        <input
          key={plan?.time_zone || browserZone}
          required
          name="time_zone"
          defaultValue={plan?.time_zone || browserZone}
          maxLength={100}
        />
        <small>
          Local clock time stays the same across daylight saving changes.
          Date-only reminders use 9 AM.
        </small>
      </label>
      <label className="field">
        <span>Repeat</span>
        <select
          name="recurrence_type"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as "interval" | "one_time")}
        >
          <option value="one_time">Does not repeat</option>
          <option value="interval">Repeats on a schedule</option>
        </select>
      </label>
      {repeat === "interval" && (
        <div className="routine-grid two">
          <label className="field">
            <span>Every</span>
            <input
              type="number"
              name="interval_value"
              required
              min={1}
              max={365}
              defaultValue={plan?.interval_value || 1}
            />
          </label>
          <label className="field">
            <span>Unit</span>
            <select
              name="interval_unit"
              defaultValue={plan?.interval_unit || "month"}
            >
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </select>
          </label>
        </div>
      )}
      <label className="field">
        <span>End date (optional)</span>
        <input
          type="date"
          name="ends_on"
          min="1900-01-01"
          max="2199-12-31"
          defaultValue={plan?.ends_on || ""}
        />
      </label>
      <label className="field">
        <span>Your instructions (optional)</span>
        <textarea
          name="instructions"
          rows={3}
          maxLength={1000}
          defaultValue={plan?.instructions || ""}
        />
      </label>
      <fieldset className="routine-reminders">
        <legend>In-app reminder timing</legend>
        {reminderOffsets.map((n) => (
          <label key={n}>
            <input
              type="checkbox"
              name="reminders"
              value={n}
              defaultChecked={(plan?.reminders || [0]).includes(n)}
            />
            {reminderText(n)}
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Your due items are always visible in Care. Automatic in-app
        notifications require the reminder worker to be configured. No email or
        push is sent.
      </p>
      {plan && (
        <p className="muted">
          Changing the schedule replaces the pending occurrence. Completed and
          skipped history stays unchanged.
        </p>
      )}
      {state.error && (
        <p role="alert" className="feedback">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : plan ? "Save routine" : "Add care routine"}
      </button>
    </form>
  );
}
