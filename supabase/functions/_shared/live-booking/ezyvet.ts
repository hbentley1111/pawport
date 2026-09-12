import { z } from "zod";
import {
  BookingError,
  type LiveSchedulingAdapter,
  type Catalog,
  type AvailabilityQuery,
  type BookingInput,
} from "./contract.ts";
import type { EzyVetCredentials } from "./credentials.ts";
import {
  parse,
  tokenSchema,
  parseSite,
  parseCatalogPage,
  normalizeAvailability,
  bookingResponseSchema,
  uid,
} from "./schemas.ts";
export type HttpTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
// Only documented trial hosts are reachable in Phase 8B. Production requires a later reviewed change.
const API = "https://api.trial.ezyvet.com",
  BOOKING = "https://apiv2.trial.ezyvet.com";
export class EzyVetAdapter implements LiveSchedulingAdapter {
  readonly system = "ezyvet" as const;
  readonly capabilities = {
    supportsAvailability: true,
    supportsAppointmentCreate: true,
  };
  private token?: { value: string; expires: number };
  private tokenPending?: Promise<string>;
  constructor(
    private credentials: EzyVetCredentials,
    private transport: HttpTransport = fetch,
    private clock = () => Date.now(),
    private timeoutMs = 10000,
  ) {}
  private async fetchBounded(url: string, init: RequestInit, booking = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      // Read within the same timeout. Never retain unrestricted vendor payloads.
      let text = "",
        bytes = 0;
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000) {
            await reader.cancel();
            throw new BookingError(booking ? "unknown" : "vendor_error");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      }
      return { status: response.status, text };
    } catch (e) {
      if (e instanceof BookingError) throw e;
      throw new BookingError(booking ? "unknown" : "unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > this.clock())
      return this.token.value;
    if (this.tokenPending) return this.tokenPending;
    this.tokenPending = (async () => {
      const r = await this.fetchBounded(API + "/v1/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.credentials),
      });
      if (r.status !== 200)
        throw new BookingError(
          r.status === 401 || r.status === 403
            ? "unauthorized"
            : r.status === 429
              ? "rate_limited"
              : "unavailable",
        );
      let raw;
      try {
        raw = JSON.parse(r.text);
      } catch {
        throw new BookingError("vendor_error");
      }
      const t = parse(tokenSchema, raw);
      this.token = {
        value: t.access_token,
        expires: this.clock() + Math.max(0, t.expires_in - 60) * 1000,
      };
      return t.access_token;
    })();
    try {
      return await this.tokenPending;
    } finally {
      this.tokenPending = undefined;
    }
  }
  private async get(path: string, params?: URLSearchParams) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await this.fetchBounded(
          API + path + (params ? "?" + params.toString() : ""),
          {
            headers: { Authorization: "Bearer " + (await this.accessToken()) },
          },
        );
      } catch (e) {
        if (
          attempt === 0 &&
          e instanceof BookingError &&
          e.code === "unavailable"
        )
          continue;
        throw e;
      }
      if (r.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (r.status >= 500 && attempt === 0) continue;
      if (r.status !== 200)
        throw new BookingError(
          r.status === 401 || r.status === 403
            ? "unauthorized"
            : r.status === 429
              ? "rate_limited"
              : r.status >= 500
                ? "unavailable"
                : "vendor_error",
        );
      try {
        return JSON.parse(r.text) as unknown;
      } catch {
        throw new BookingError("vendor_error");
      }
    }
    throw new BookingError("unavailable");
  }
  async getCatalog(): Promise<Catalog> {
    const load = async (kind: "resource" | "appointmenttype") => {
      if (kind === "resource") {
        const r = parseCatalogPage(
          await this.get(
            "/v2/resource",
            new URLSearchParams({ active: "true" }),
          ),
          kind,
        );
        if (r.pages > 1) throw new BookingError("vendor_error");
        return r.items;
      }
      const result: { id: string; name: string }[] = [];
      for (let page = 1; page <= 20; page++) {
        const r = parseCatalogPage(
          await this.get(
            "/v2/" + kind,
            new URLSearchParams({
              active: "true",
              page: String(page),
              limit: "50",
            }),
          ),
          kind,
        );
        if (!Number.isInteger(r.pages) || r.pages < 0 || r.pages > 20)
          throw new BookingError("vendor_error");
        result.push(...r.items);
        if (page >= r.pages)
          return [...new Map(result.map((v) => [v.id, v])).values()];
      }
      throw new BookingError("vendor_error");
    };
    const [site, appointmentTypes, resources] = await Promise.all([
      this.get("/v3/siteInformation").then((r) =>
        parseSite(r, this.credentials.site_uid),
      ),
      load("appointmenttype"),
      load("resource"),
    ]);
    return { site, appointmentTypes, resources };
  }
  async listAvailability(query: AvailabilityQuery) {
    const input = parse(
      z.object({
        appointmentTypeId: z
          .string()
          .regex(/^appointmentType_[A-Za-z0-9]{21}$/),
        durationMinutes: z.number().int().min(10).max(360).multipleOf(5),
        resourceIds: z
          .array(z.string().regex(/^resource_[A-Za-z0-9]{21}$/))
          .min(1)
          .max(25),
        dates: z.array(z.iso.date()).min(1).max(7),
      }),
      query,
    );
    if (
      new Set(input.resourceIds).size !== input.resourceIds.length ||
      new Set(input.dates).size !== input.dates.length
    )
      throw new BookingError("vendor_error");
    const slots = [];
    for (let i = 0; i < input.resourceIds.length; i += 5) {
      const ids = input.resourceIds.slice(i, i + 5),
        params = new URLSearchParams({
          duration: String(input.durationMinutes),
          "filter[slots.available][eq]": "true",
          "filter[slots.appointmentType.id][in]": input.appointmentTypeId,
        });
      for (const r of ids) params.append("resources[]", r);
      for (const d of input.dates) params.append("dates[]", d);
      slots.push(
        ...normalizeAvailability(
          await this.get("/v4/calendar/availability", params),
          { ...query, resourceIds: ids },
        ),
      );
    }
    // One slot per service/time; deterministic resource choice, never a browser-selected vendor UID.
    return [
      ...new Map(
        slots
          .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
          .map((s) => [s.startsAt + "|" + s.endsAt, s]),
      ).values(),
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  async validateConnection(query: AvailabilityQuery) {
    const c = await this.getCatalog();
    if (
      !c.appointmentTypes.some((t) => t.id === query.appointmentTypeId) ||
      query.resourceIds.some((id) => !c.resources.some((r) => r.id === id))
    )
      throw new BookingError("unavailable");
    await this.listAvailability({ ...query, site: c.site });
    return c;
  }
  async bookAppointment(input: BookingInput) {
    const animal = parse(uid("animal"), input.animalId),
      contact = parse(uid("contact"), input.contactId),
      provider = parse(uid("resource"), input.resourceId),
      type = parse(uid("appointmentType"), input.appointmentTypeId);
    const duration =
      (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 60000;
    if (
      !Number.isInteger(duration) ||
      duration < 10 ||
      duration > 360 ||
      duration % 5 ||
      Date.parse(input.startsAt) <= this.clock()
    )
      throw new BookingError("vendor_error");
    const token = await this.accessToken();
    // Exactly one POST. A timeout, malformed success, redirect, or server failure is ambiguous.
    const r = await this.fetchBounded(
      BOOKING + "/ezycab/booking",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startTime: input.startsAt,
          type,
          durationMinutes: duration,
          appointmentStatus: "confirmed",
          animal,
          contact,
          provider,
        }),
      },
      true,
    );
    if (r.status !== 200) {
      if (r.status === 401) {
        this.token = undefined;
        throw new BookingError("unauthorized");
      }
      if (r.status === 403) throw new BookingError("unauthorized");
      if (r.status === 429) throw new BookingError("rate_limited");
      if ([400, 404, 422].includes(r.status))
        throw new BookingError("vendor_error");
      throw new BookingError("unknown");
    }
    try {
      const b = parse(bookingResponseSchema, JSON.parse(r.text));
      return { externalAppointmentId: b.appointment };
    } catch {
      throw new BookingError("unknown");
    }
  }
}
