import { createHash } from "node:crypto";
import type { Appointment } from "./schema";
const stamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const escape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
export function foldCalendarLine(line: string) {
  let result = "",
    width = 0;
  for (const c of line) {
    const bytes = Buffer.byteLength(c, "utf8");
    if (width + bytes > 75) {
      result += "\r\n ";
      width = 1;
    }
    result += c;
    width += bytes;
  }
  return result;
}
export function appointmentCalendar(
  a: Appointment,
  petName: string,
  appOrigin: string,
) {
  const origin = new URL(appOrigin);
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid calendar origin");
  const url = `${origin.origin}/appointments/${encodeURIComponent(a.id)}`;
  const uid = createHash("sha256").update(`pawport-care:${a.id}`).digest("hex");
  // Deliberate allowlist: no notes, Google-derived content, reminder details or auth IDs.
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pawport//Care Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@pawport`,
    `DTSTAMP:${stamp(a.updated_at)}`,
    `LAST-MODIFIED:${stamp(a.updated_at)}`,
    `DTSTART:${stamp(a.starts_at)}`,
  ];
  if (a.ends_at) lines.push(`DTEND:${stamp(a.ends_at)}`);
  lines.push(
    `SUMMARY:${escape(`${petName} — ${a.title}`)}`,
    `DESCRIPTION:${escape([`Care for ${petName}`, a.provider_name ? `Provider: ${a.provider_name}` : "", `Pawport: ${url}`].filter(Boolean).join("\n"))}`,
  );
  if (a.location_text) lines.push(`LOCATION:${escape(a.location_text)}`);
  lines.push(
    `URL:${url}`,
    `STATUS:${a.status === "cancelled" ? "CANCELLED" : ["requested", "waitlisted"].includes(a.status) ? "TENTATIVE" : "CONFIRMED"}`,
    "CLASS:PRIVATE",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldCalendarLine).join("\r\n") + "\r\n";
}
