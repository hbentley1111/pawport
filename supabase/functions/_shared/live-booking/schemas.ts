import { z } from "zod";
import {
  BookingError,
  type AvailabilityQuery,
  type LiveSlot,
  type Catalog,
} from "./contract.ts";
export const uid = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
export const timeZone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v }).format();
      return true;
    } catch {
      return false;
    }
  });
export const tokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().int().min(1).max(86400),
});
const reference = (type: string) =>
  z.object({ id: uid(type), type: z.literal(type) });
const slotSchema = z.object({
  start: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
  duration: z.number().int().min(10).max(360).multipleOf(5),
  available: z.boolean(),
  relationships: z.object({
    appointmentType: z.object({
      data: z.array(reference("appointmentType")).max(1000),
    }),
  }),
});
const availabilitySchema = z.object({
  data: z
    .array(
      z.object({
        id: uid("resourceAvailability"),
        type: z.literal("resourceAvailability"),
        attributes: z.object({
          date: z.iso.date(),
          timezone: timeZone,
          slots: z.array(slotSchema).max(2000),
        }),
        relationships: z.object({
          site: reference("site"),
          resource: reference("resource"),
        }),
      }),
    )
    .max(35),
});
export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success) throw new BookingError("vendor_error");
  return p.data;
}
export function localDate(instant: number | string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function nextSevenDates(now: number, zone: string) {
  const start = localDate(now, zone);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(start + "T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );
}
export function normalizeAvailability(
  raw: unknown,
  query: AvailabilityQuery,
): LiveSlot[] {
  const rows = parse(availabilitySchema, raw).data;
  const output: LiveSlot[] = [];
  for (const row of rows) {
    const a = row.attributes;
    const resource = row.relationships.resource.id;
    if (
      row.relationships.site.id !== query.site.id ||
      a.timezone !== query.site.timeZone ||
      !query.resourceIds.includes(resource) ||
      !query.dates.includes(a.date)
    )
      throw new BookingError("vendor_error");
    for (const slot of a.slots) {
      if (
        !slot.available ||
        slot.duration !== query.durationMinutes ||
        !slot.relationships.appointmentType.data.some(
          (t) => t.id === query.appointmentTypeId,
        )
      )
        continue;
      const rawStart = a.date + "T" + slot.start;
      const start = Date.parse(rawStart);
      if (!Number.isFinite(start) || localDate(start, a.timezone) !== a.date)
        throw new BookingError("vendor_error");
      // Verify returned offset agrees with the site's local clock, including DST folds/gaps.
      const clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: a.timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(new Date(start));
      if (clock !== slot.start.slice(0, 8))
        throw new BookingError("vendor_error");
      output.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + slot.duration * 60000).toISOString(),
        timeZone: a.timezone,
        resourceId: resource,
        appointmentTypeId: query.appointmentTypeId,
      });
    }
  }
  return output;
}
export function parseSite(raw: unknown, expectedSite: string): Catalog["site"] {
  const s = parse(
    z.object({
      data: z.object({
        id: uid("site"),
        type: z.literal("siteInformation"),
        relationships: z.object({
          timezone: z.object({
            data: z.object({
              type: z.literal("timezone"),
              id: z.union([z.number(), z.string()]),
            }),
          }),
        }),
        included: z
          .array(
            z.object({
              id: z.union([z.number(), z.string()]),
              type: z.string(),
              attributes: z
                .object({ name: z.string().optional() })
                .passthrough(),
            }),
          )
          .max(100),
      }),
    }),
    raw,
  ).data;
  const zone = s.included.find(
    (v) =>
      v.type === "timezone" &&
      String(v.id) === String(s.relationships.timezone.data.id),
  )?.attributes.name;
  if (s.id !== expectedSite || !timeZone.safeParse(zone).success)
    throw new BookingError("vendor_error");
  return { id: s.id, timeZone: zone! };
}
export function parseCatalogPage(
  raw: unknown,
  kind: "resource" | "appointmenttype",
) {
  const envelope = parse(
    z.object({
      meta: z.object({
        items_page_total: z.union([
          z.number().int(),
          z.string().regex(/^\d+$/),
        ]),
      }),
      items: z.array(z.record(z.string(), z.unknown())).max(500),
    }),
    raw,
  );
  const rows = envelope.items.map((item) =>
    parse(
      z.object({
        uid: uid(kind === "resource" ? "resource" : "appointmentType"),
        name: z.string().min(1).max(255),
        active: z.boolean(),
        ...(kind === "resource"
          ? { access: z.enum(["None", "On Calendar", "Member"]) }
          : {}),
      }),
      item[kind],
    ),
  );
  return {
    pages: Number(envelope.meta.items_page_total),
    items: rows
      .filter((r) => r.active && (!("access" in r) || r.access !== "None"))
      .map((r) => ({ id: r.uid, name: r.name })),
  };
}
export const bookingResponseSchema = z.object({
  id: uid("bookingRequest"),
  appointment: uid("appointment"),
});
