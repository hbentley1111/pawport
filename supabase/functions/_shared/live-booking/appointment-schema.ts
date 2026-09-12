import { z } from "zod";
import { parse, uid } from "./schemas.ts";
import { BookingError, type VendorAppointment } from "./contract.ts";
const row = z.object({
  id: z.number().int().positive(),
  uid: uid("appointment"),
  active: z.boolean(),
  start_at: z.number().int().nonnegative(),
  duration: z.number().int().positive().max(86400),
  modified_at: z.number().int().nonnegative(),
  animal_uid: uid("animal"),
  contact_uid: uid("contact"),
  type_uid: uid("appointmentType"),
  resources: z.array(z.object({ uid: uid("resource") })).max(100),
});
export function lookupNumericId(raw: unknown, externalId: string) {
  const data = parse(
    z.object({
      items: z
        .array(
          z.object({
            appointment: z.object({
              id: z.number().int().positive(),
              uid: uid("appointment"),
            }),
          }),
        )
        .length(1),
    }),
    raw,
  );
  const a = data.items[0].appointment;
  if (a.uid !== externalId) throw new BookingError("conflict");
  return a.id;
}
export function parseCalendarAppointment(
  raw: unknown,
  externalId: string,
  numericId: number,
): VendorAppointment {
  const data = parse(
    z.object({
      meta: z.object({ nextToken: z.null().optional() }),
      data: z.array(row).length(1),
    }),
    raw,
  );
  const a = data.data[0];
  if (a.uid !== externalId || a.id !== numericId)
    throw new BookingError("conflict");
  return {
    id: a.id,
    externalAppointmentId: a.uid,
    active: a.active,
    startsAt: new Date(a.start_at * 1000).toISOString(),
    endsAt: new Date((a.start_at + a.duration) * 1000).toISOString(),
    modifiedAt: a.modified_at,
    animalId: a.animal_uid,
    contactId: a.contact_uid,
    appointmentTypeId: a.type_uid,
    resourceIds: a.resources.map((r) => r.uid),
  };
}
export function verifyCancellationResponse(
  raw: unknown,
  expected: VendorAppointment,
) {
  const data = parse(
    z.object({
      items: z
        .array(
          z.object({
            appointment: z.object({
              id: z.number().int().positive(),
              uid: uid("appointment"),
              active: z.literal(false),
            }),
          }),
        )
        .length(1),
    }),
    raw,
  );
  const a = data.items[0].appointment;
  if (a.id !== expected.id || a.uid !== expected.externalAppointmentId)
    throw new BookingError("unknown");
  return { ...expected, active: false };
}
