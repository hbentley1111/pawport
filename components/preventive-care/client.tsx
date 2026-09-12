"use client";
import { useEffect, useState, useActionState } from "react";
import { useLocalZone } from "@/components/care/local-time";
import { preventiveAction } from "@/app/pets/[petId]/care/actions";
import type {
  PreventiveCare,
  PreventiveSummary,
  PreventiveProfile,
  Guidance,
} from "@/lib/preventive-care/schema";
import { PreventiveSnapshot, PreventiveSummaryCard } from "./presentation";
export function PreventiveLoader({ petId }: { petId?: string }) {
  const [data, setData] = useState<PreventiveCare | PreventiveSummary[] | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      "/api/preventive-care?" +
        new URLSearchParams({
          zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(petId ? { pet: petId } : {}),
        }),
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [petId]);
  if (error) return <p role="status">{error}</p>;
  if (!data) return <p role="status">Loading preventive care…</p>;
  return Array.isArray(data) ? (
    <section className="routine-summary">
      <h2>Preventive care</h2>
      {data.map((s) => (
        <PreventiveSummaryCard key={s.petId} summary={s} />
      ))}
    </section>
  ) : (
    <PreventiveSnapshot data={data} />
  );
}
export function PetPreventiveCard({
  petId,
  petName,
}: {
  petId: string;
  petName: string;
}) {
  return (
    <section className="routine-summary">
      <h2>Preventive care</h2>
      <PetSummary petId={petId} petName={petName} />
    </section>
  );
}
function PetSummary({ petId, petName }: { petId: string; petName: string }) {
  const [summary, setSummary] = useState<PreventiveSummary | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(
      "/api/preventive-care?" +
        new URLSearchParams({
          pet: petId,
          zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      { cache: "no-store", signal: c.signal },
    )
      .then(async (r) => {
        if (!r.ok) return;
        const d: PreventiveCare = await r.json();
        setSummary({
          petId,
          petName,
          attentionCount: d.needsAttention.length,
          upcomingCount: d.upcoming.length,
          guidanceCount: d.guidance.length,
        });
      })
      .catch(() => {});
    return () => c.abort();
  }, [petId, petName]);
  return summary ? (
    <PreventiveSummaryCard summary={summary} />
  ) : (
    <a className="document-link" href={`/pets/${petId}/care`}>
      View {petName}’s care
    </a>
  );
}
export function GuidanceActions({
  petId,
  guidance,
}: {
  petId: string;
  guidance: Guidance;
}) {
  const [result, submit, pending] = useActionState(preventiveAction, {}),
    zone = useLocalZone(),
    [until, setUntil] = useState("");
  function preset(months: number, days = 0) {
    const d = new Date(),
      anchor = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    d.setDate(
      Math.min(
        anchor,
        new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
      ),
    );
    d.setDate(d.getDate() + days);
    setUntil(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return (
    <form action={submit} className="business-form routine-card">
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="rule" value={guidance.ruleKey} />
      <input type="hidden" name="zone" value={zone} />
      <p>
        These actions organize a discussion topic. They do not change health
        records or due dates.
      </p>
      <div className="care-page-links">
        <button
          className="button secondary"
          name="state"
          value="discussed"
          disabled={pending}
        >
          Discussed with veterinarian
        </button>
        <button
          className="button secondary"
          name="state"
          value="not_relevant"
          disabled={pending}
        >
          Not relevant
        </button>
        <button
          className="button secondary"
          name="state"
          value="active"
          disabled={pending}
        >
          Show topic again
        </button>
      </div>
      <fieldset>
        <legend>Remind me later</legend>
        <p className="fine-print">
          This topic will reappear here on your chosen date. No notification or
          message is sent.
        </p>
        <div className="care-page-links">
          <button
            type="button"
            className="button secondary"
            onClick={() => preset(0, 7)}
          >
            1 week
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => preset(1)}
          >
            1 month
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => preset(3)}
          >
            3 months
          </button>
        </div>
        <label>
          Show topic again on
          <input
            type="date"
            name="until"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <button
          className="button"
          name="state"
          value="snoozed"
          disabled={pending || !until}
        >
          Save reminder date
        </button>
      </fieldset>
      {result.error && <p role="alert">{result.error}</p>}
      {result.success && <p role="status">{result.success}</p>}
    </form>
  );
}
export function PreventiveProfileForm({
  petId,
  profile,
}: {
  petId: string;
  profile: PreventiveProfile | null;
}) {
  const [result, submit, pending] = useActionState(preventiveAction, {});
  return (
    <form action={submit} className="business-form business-panel">
      <input type="hidden" name="pet" value={petId} />
      <input type="hidden" name="action" value="profile" />
      {(
        [
          [
            "indoor_outdoor",
            "Indoor/outdoor lifestyle",
            ["indoor", "mostly_indoor", "mixed", "mostly_outdoor", "outdoor"],
          ],
          [
            "social_exposure",
            "Contact with other animals",
            ["minimal", "some", "frequent"],
          ],
          ["travel_frequency", "Travel", ["rare", "occasional", "frequent"]],
        ] as const
      ).map(([key, label, values]) => (
        <label key={key}>
          {label}
          <select name={key} defaultValue={profile?.[key] || ""}>
            <option value="">Not specified</option>
            {values.map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      ))}
      {(["boarding_grooming_exposure", "wildlife_exposure"] as const).map(
        (key) => (
          <label key={key}>
            {key === "wildlife_exposure"
              ? "Wildlife exposure"
              : "Boarding, grooming or daycare"}
            <select
              name={key}
              defaultValue={
                profile?.[key] === true
                  ? "yes"
                  : profile?.[key] === false
                    ? "no"
                    : ""
              }
            >
              <option value="">Not specified</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        ),
      )}
      <label>
        Anything you’d like to remember
        <textarea
          name="owner_notes"
          maxLength={500}
          rows={4}
          defaultValue={profile?.owner_notes || ""}
        />
      </label>
      <p>
        These answers stay private and are not sent to a provider. They do not
        replace veterinary advice.
      </p>
      <button className="button" disabled={pending}>
        {pending ? "Saving…" : "Save care profile"}
      </button>
      {result.error && <p role="alert">{result.error}</p>}
      {result.success && <p role="status">{result.success}</p>}
    </form>
  );
}
