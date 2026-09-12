import { z } from "zod";
import { BookingError, type LiveSchedulingAdapter } from "./contract.ts";
import { localDate, nextSevenDates } from "./schemas.ts";

export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("availability"),
      locationId: z.uuid(),
      serviceId: z.uuid(),
      petId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal("book"), quoteId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("provider_catalog"),
      organizationId: z.uuid(),
      locationId: z.uuid(),
      connectionId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal("intake"), locationId: z.uuid() }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export type Rpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T>;
type Context = {
  connectionId: string;
  credentialRef: string;
  appointmentTypeId: string;
  durationMinutes: number;
  resourceIds: string[];
  profileTimeZone: string;
  externalPetId: string;
  externalOwnerId: string;
  attemptId: string;
  startsAt: string;
  endsAt: string;
  resourceId: string;
  timeZone: string;
  serviceId: string;
  name: string;
  state: string;
  appointmentId?: string;
};
export function createPipeline(
  rpc: Rpc,
  resolve: (ref: string) => Promise<LiveSchedulingAdapter>,
  clock = () => Date.now(),
) {
  const adapter = async (c: Context) => {
    const a = await resolve(c.credentialRef);
    if (
      a.system !== "ezyvet" ||
      !a.capabilities.supportsAvailability ||
      !a.capabilities.supportsAppointmentCreate
    )
      throw new BookingError("unavailable");
    return a;
  };
  const validate = async (
    c: Context,
    dates?: string[],
    exactResource?: string,
  ) => {
    const a = await adapter(c);
    const catalog = await a.getCatalog();
    if (
      !catalog.appointmentTypes.some((t) => t.id === c.appointmentTypeId) ||
      c.resourceIds.some((id) => !catalog.resources.some((r) => r.id === id))
    )
      throw new BookingError("unavailable");
    const slots = await a.listAvailability({
      appointmentTypeId: c.appointmentTypeId,
      durationMinutes: c.durationMinutes,
      resourceIds: exactResource ? [exactResource] : c.resourceIds,
      dates: dates || nextSevenDates(clock(), catalog.site.timeZone),
      site: catalog.site,
    });
    await rpc("record_live_connection_validation", {
      p_connection: c.connectionId,
      p_zone: catalog.site.timeZone,
    });
    return { a, catalog, slots };
  };
  return async (user: string, action: Action): Promise<unknown> => {
    const p_user = user;
    if (action.action === "provider_catalog") {
      const c = await rpc<Context>("prepare_live_provider_catalog", {
        p_user,
        p_organization: action.organizationId,
        p_location: action.locationId,
        p_connection: action.connectionId,
      });
      const a = await adapter(c),
        catalog = await a.getCatalog();
      if (!catalog.appointmentTypes.length || !catalog.resources.length)
        throw new BookingError("unavailable");
      await a.listAvailability({
        appointmentTypeId: catalog.appointmentTypes[0].id,
        durationMinutes: 30,
        resourceIds: [catalog.resources[0].id],
        dates: [nextSevenDates(clock(), catalog.site.timeZone)[0]],
        site: catalog.site,
      });
      await rpc("record_live_connection_validation", {
        p_connection: c.connectionId,
        p_zone: catalog.site.timeZone,
      });
      return {
        ...catalog,
        timeZoneMismatch: catalog.site.timeZone !== c.profileTimeZone,
        environment: "sandbox",
      };
    }
    if (action.action === "intake") {
      const candidates = await rpc<Context[]>("prepare_live_intake", {
        p_user,
        p_location: action.locationId,
      });
      const services = [];
      // Bounded work, never advertise an unchecked service. Larger catalogs can be paged later.
      for (const c of candidates.slice(0, 5)) {
        try {
          const { catalog } = await validate(c);
          services.push({
            id: c.serviceId,
            name: c.name,
            timeZone: catalog.site.timeZone,
          });
        } catch {
          /* Fail closed; requests remain available. */
        }
      }
      return { services, environment: "sandbox" };
    }
    if (action.action === "availability") {
      const args = {
        p_user,
        p_location: action.locationId,
        p_service: action.serviceId,
        p_pet: action.petId,
      };
      const c = await rpc<Context>("prepare_live_availability_context", args);
      const { catalog, slots } = await validate(c);
      const quotes = await rpc("store_live_booking_quotes", {
        ...args,
        p_zone: catalog.site.timeZone,
        p_slots: slots
          .filter((s) => Date.parse(s.startsAt) > clock())
          .slice(0, 100)
          .map((s) => ({
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            resourceId: s.resourceId,
          })),
      });
      return {
        quotes,
        timeZone: catalog.site.timeZone,
        environment: "sandbox",
      };
    }
    const c = await rpc<Context>("begin_live_booking", {
      p_user,
      p_quote: action.quoteId,
    });
    if (c.state === "completed")
      return { state: "completed", appointmentId: c.appointmentId };
    if (c.state === "finalize") {
      try {
        return {
          state: "completed",
          appointmentId: await rpc("complete_live_booking", {
            p_user,
            p_attempt: c.attemptId,
          }),
        };
      } catch {
        // Vendor confirmation already exists. Never present this as safe to rebook.
        throw new BookingError("unknown");
      }
    }
    if (c.state !== "initiated")
      throw new BookingError(
        c.state === "slot_gone"
          ? "slot_gone"
          : c.state === "failed"
            ? "vendor_error"
            : "unknown",
      );
    let posted = false,
      vendorResponded = false;
    try {
      const { a, catalog, slots } = await validate(
        c,
        [localDate(c.startsAt, c.timeZone)],
        c.resourceId,
      );
      if (
        catalog.site.timeZone !== c.timeZone ||
        !slots.some(
          (s) =>
            Date.parse(s.startsAt) === Date.parse(c.startsAt) &&
            Date.parse(s.endsAt) === Date.parse(c.endsAt) &&
            s.resourceId === c.resourceId,
        )
      )
        throw new BookingError("slot_gone");
      await rpc("reconfirm_live_booking", { p_user, p_attempt: c.attemptId });
      posted = true;
      const result = await a.bookAppointment({
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        timeZone: c.timeZone,
        resourceId: c.resourceId,
        appointmentTypeId: c.appointmentTypeId,
        animalId: c.externalPetId,
        contactId: c.externalOwnerId,
      });
      vendorResponded = true;
      await rpc("record_live_vendor_confirmation", {
        p_user,
        p_attempt: c.attemptId,
        p_external_id: result.externalAppointmentId,
      });
      const appointmentId = await rpc("complete_live_booking", {
        p_user,
        p_attempt: c.attemptId,
      });
      return { state: "completed", appointmentId };
    } catch (error) {
      const code = vendorResponded
        ? "unknown"
        : error instanceof BookingError
          ? error.code
          : posted
            ? "unknown"
            : "unavailable";
      try {
        await rpc("fail_live_booking", {
          p_user,
          p_attempt: c.attemptId,
          p_code: code,
        });
      } catch {
        /* Durable initiated/reconfirmed attempts also block retries. */
      }
      throw new BookingError(code);
    }
  };
}
