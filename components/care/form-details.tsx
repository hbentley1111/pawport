import {
  careTypes,
  careStatuses,
  careLabel,
  type Appointment,
} from "@/lib/care/schema";
export function CareFormDetails({
  appointment: a,
}: {
  appointment?: Appointment;
}) {
  return (
    <>
      {" "}
      <div className="form-grid">
        <label className="field">
          <span>Care type</span>
          <select
            name="appointment_type"
            defaultValue={a?.appointment_type || "veterinary"}
          >
            {careTypes.map((t) => (
              <option key={t} value={t}>
                {careLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select name="status" defaultValue={a?.status || "scheduled"}>
            {careStatuses.map((s) => (
              <option key={s} value={s}>
                {careLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Title</span>
        <input
          name="title"
          required
          maxLength={120}
          defaultValue={a?.title || ""}
          placeholder="Annual wellness visit"
        />
      </label>
    </>
  );
}
