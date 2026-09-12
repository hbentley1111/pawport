"use client";
import { useActionState, useState } from "react";
import { saveMoment, deleteMoment } from "@/app/pets/[petId]/timeline/actions";
import { journalTypes, type JournalEntry } from "@/lib/timeline/schema";
import { localDateTime, occurrenceFor } from "@/lib/care/time";
import { useLocalZone } from "../care/local-time";
import { photoSchema } from "@/lib/pets";
export function MomentForm({
  petId,
  entry,
  currentPhoto,
  now,
}: {
  petId: string;
  entry?: JournalEntry;
  currentPhoto?: string | null;
  now: string;
}) {
  const [state, submit, pending] = useActionState(saveMoment, {}),
    [type, setType] = useState(entry?.entry_type || "note");
  const zone = useLocalZone();
  const [photo, setPhoto] = useState(entry?.photo_id || ""),
    [uploading, setUploading] = useState(false),
    [photoError, setPhotoError] = useState("");
  return (
    <div className="moment-editor">
      {type === "photo" && (
        <div className="care-form">
          <label className="field">
            <span>Upload a private photo</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              disabled={uploading || pending}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const parsed = photoSchema.safeParse({
                  name: file.name,
                  type: file.type,
                  size: file.size,
                });
                if (!parsed.success) {
                  setPhotoError(parsed.error.issues[0].message);
                  return;
                }
                setUploading(true);
                setPhotoError("");
                try {
                  const data = new FormData();
                  data.set("pet_id", petId);
                  data.set("purpose", "journal");
                  data.set("file", file);
                  const response = await fetch("/pet-photos/upload", {
                      method: "POST",
                      body: data,
                    }),
                    result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error || "Upload unavailable.");
                  setPhoto(result.photo_id);
                } catch (error) {
                  setPhotoError(
                    error instanceof Error
                      ? error.message
                      : "Upload interrupted.",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          <p className="muted">
            JPG or PNG · up to 3 MiB. Private to your household. Your profile
            photo stays unchanged.
          </p>
          {currentPhoto && (
            <button
              type="button"
              className="button secondary"
              disabled={uploading || pending}
              onClick={() => setPhoto(currentPhoto)}
            >
              Use current profile photo
            </button>
          )}
          {uploading && <p role="status">Uploading photo…</p>}
          {photo && (
            <p role="status">
              Photo selected. Save the moment to keep it in the timeline.
            </p>
          )}
          {photoError && (
            <p role="alert" className="feedback">
              {photoError}
            </p>
          )}
        </div>
      )}
      <form action={submit} className="care-form routine-form">
        <input type="hidden" name="id" value={entry?.id || ""} />
        <input type="hidden" name="pet_id" value={petId} />
        <input type="hidden" name="photo_id" value={photo} />
        <p className="routine-provenance">
          Owner added · a private piece of their story
        </p>
        <label className="field">
          <span>Moment</span>
          {entry ? (
            <>
              <input readOnly value={type} />
              <input type="hidden" name="entry_type" value={type} />
            </>
          ) : (
            <select
              name="entry_type"
              value={type}
              disabled={uploading}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {journalTypes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="field">
          <span>Title{type === "milestone" ? "" : " (optional)"}</span>
          <input
            name="title"
            required={type === "milestone"}
            maxLength={120}
            defaultValue={entry?.title || ""}
          />
        </label>
        {type === "weight" && (
          <div className="routine-grid two">
            <label className="field">
              <span>Weight</span>
              <input
                name="weight_value"
                type="number"
                step="0.001"
                min="0.001"
                required
                defaultValue={entry?.weight_value || ""}
              />
            </label>
            <label className="field">
              <span>Unit</span>
              <select
                name="weight_unit"
                defaultValue={entry?.weight_unit || "lb"}
              >
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </label>
          </div>
        )}
        <label className="field">
          <span>Note (optional)</span>
          <textarea
            name="note"
            maxLength={2000}
            rows={4}
            defaultValue={entry?.note || ""}
          />
        </label>
        <label className="field">
          <span>Date and time</span>
          <input
            key={entry?.time_zone || zone}
            type="datetime-local"
            name="local_time"
            required
            min="1900-01-01T00:00"
            defaultValue={localDateTime(
              entry?.occurred_at || now,
              entry?.time_zone || zone,
            )}
          />
        </label>
        <label className="field">
          <span>Time zone</span>
          <input
            key={entry?.time_zone || zone}
            name="time_zone"
            required
            maxLength={100}
            defaultValue={entry?.time_zone || zone}
          />
        </label>
        <details>
          <summary>Daylight saving time</summary>
          <label className="field">
            <span>If this clock time occurs twice</span>
            <select
              name="fold"
              defaultValue={
                entry
                  ? occurrenceFor(entry.occurred_at, entry.time_zone)
                  : "earlier"
              }
            >
              <option value="earlier">First occurrence</option>
              <option value="later">Second occurrence</option>
            </select>
          </label>
        </details>
        <p className="muted">
          Past moments are welcome. Future routines belong in Care.
        </p>
        {state.error && (
          <p role="alert" className="feedback">
            {state.error}
          </p>
        )}
        <button
          className="button"
          disabled={pending || uploading || (type === "photo" && !photo)}
        >
          {pending ? "Saving…" : entry ? "Save moment" : "Add moment"}
        </button>
      </form>
    </div>
  );
}
export function DeleteMoment({ id, petId }: { id: string; petId: string }) {
  const [state, submit, pending] = useActionState(deleteMoment, {});
  return (
    <details className="routine-summary">
      <summary>Delete moment</summary>
      <p>
        This removes your journal moment from the timeline. Medical records and
        care history stay unchanged.
      </p>
      <form action={submit}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="pet_id" value={petId} />
        <button className="button secondary" disabled={pending}>
          Delete this moment
        </button>
        {state.error && <p role="alert">{state.error}</p>}
      </form>
    </details>
  );
}
