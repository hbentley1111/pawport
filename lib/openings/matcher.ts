import { localDateTime } from "@/lib/care/time";
import type { AvailabilitySlot } from "@/lib/care/scheduling-adapter";
import { availabilitySlotSchema, type WatchConstraints } from "./schema";
// Pure matching core used only behind worker transport. Weekdays/time are watch-local.
export function matchAvailability(
  w: WatchConstraints,
  input: unknown[],
  now: number,
): AvailabilitySlot[] {
  if (input.length > 100) throw new Error("Availability result limit exceeded");
  const unique = new Map<string, AvailabilitySlot>();
  for (const raw of input) {
    const slot = availabilitySlotSchema.parse(raw);
    const at = Date.parse(slot.startsAt);
    const wall = localDateTime(at, w.time_zone),
      date = wall.slice(0, 10),
      time =
        wall.slice(11) +
        ":" +
        String(new Date(at).getUTCSeconds()).padStart(2, "0") +
        (new Date(at).getUTCMilliseconds()
          ? "." + String(new Date(at).getUTCMilliseconds()).padStart(3, "0")
          : "");
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    if (
      !slot.bookable ||
      slot.connectionId !== w.connection_id ||
      at <= now ||
      at >= Date.parse(w.expires_at) ||
      (w.current_appointment_start &&
        at >= Date.parse(w.current_appointment_start)) ||
      date < w.earliest_date ||
      date > w.latest_date ||
      (w.earliest_time &&
        time <
          (w.earliest_time.length === 5
            ? w.earliest_time + ":00"
            : w.earliest_time)) ||
      (w.latest_time &&
        time >
          (w.latest_time.length === 5
            ? w.latest_time + ":00"
            : w.latest_time)) ||
      (w.allowed_weekdays && !w.allowed_weekdays.includes(weekday)) ||
      (w.appointment_type && slot.appointmentType !== w.appointment_type) ||
      (w.external_service_id &&
        slot.externalServiceId !== w.external_service_id) ||
      (w.external_staff_id && slot.externalStaffId !== w.external_staff_id)
    )
      continue;
    const key = JSON.stringify([
      slot.externalSlotId,
      new Date(at).toISOString(),
    ]);
    unique.set(key, {
      ...slot,
      startsAt: new Date(at).toISOString(),
      endsAt: new Date(slot.endsAt).toISOString(),
    });
  }
  return [...unique.values()].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}
