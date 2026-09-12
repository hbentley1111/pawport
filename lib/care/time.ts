// Wall-clock conversion without a server-local timezone dependency.
export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function localDateTime(instant: string | number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function wallNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid date and time.");
  const date = new Date(`${value}:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 16) !== value ||
    date.getUTCFullYear() < 1900 ||
    date.getUTCFullYear() >= 2200
  )
    throw new Error("Choose a valid date between 1900 and 2199.");
  return date.getTime();
}
export function wallTimeCandidates(value: string, zone: string) {
  if (!validTimeZone(zone))
    throw new Error(
      "Your time zone could not be determined. Reload and try again.",
    );
  const base = wallNumber(value),
    offsets = new Set<number>();
  // Sample both sides of a transition, including non-hour offsets and date-line zones.
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = base + hours * 3600000;
    offsets.add(
      new Date(`${localDateTime(instant, zone)}:00Z`).getTime() - instant,
    );
  }
  return [...offsets]
    .map((offset) => base - offset)
    .filter((instant) => localDateTime(instant, zone) === value)
    .sort((a, b) => a - b);
}
export function wallTimeToISO(
  value: string,
  zone: string,
  occurrence: "earlier" | "later" = "earlier",
) {
  const candidates = wallTimeCandidates(value, zone);
  if (!candidates.length)
    throw new Error(
      "This local time does not exist because the clocks change. Choose another time.",
    );
  return new Date(
    occurrence === "later" ? candidates[candidates.length - 1] : candidates[0],
  ).toISOString();
}
export function occurrenceFor(
  instant: string,
  zone: string,
): "earlier" | "later" {
  const candidates = wallTimeCandidates(localDateTime(instant, zone), zone);
  return candidates.length > 1 &&
    Date.parse(instant) >= candidates[candidates.length - 1]
    ? "later"
    : "earlier";
}
export function careDate(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(instant));
}
export function careTime(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
}
