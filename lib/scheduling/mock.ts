import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type {
  SchedulingAdapter,
  SchedulingConnection,
  SchedulingEvent,
  ExternalAppointment,
  WebhookRequest,
  VerifiedWebhook,
  AvailabilitySlot,
} from "@/lib/care/scheduling-adapter";
import { schedulingEventSchema } from "./schema";
export function assertMockEnabled() {
  if (
    !["development", "test"].includes(process.env.NODE_ENV || "") ||
    process.env.PAWPORT_ENABLE_MOCK_SCHEDULING !== "true" ||
    process.env.VERCEL_ENV === "production"
  )
    throw new Error("Mock scheduling disabled");
}
export class MockSchedulingAdapter implements SchedulingAdapter {
  readonly system = "mock" as const;
  readonly capabilities = Object.freeze({
    supportsAppointmentRead: true,
    supportsAppointmentCreate: false,
    supportsCancellation: true,
    supportsAvailability: true,
    supportsWebhooks: true,
    supportsPetLookup: true,
  });
  private readonly key = randomBytes(32); // Ephemeral test signing key, never persisted or configured in production.
  private readonly appointments = new Map<string, ExternalAppointment>();
  private readonly verified = new WeakSet<object>();
  constructor(
    private readonly connectionId: string,
    private readonly clock = () => Date.now(),
  ) {
    assertMockEnabled();
    this.appointments.set("demo-visit", {
      externalId: "demo-visit",
      externalPetReference: "demo-pet",
      version: 1,
      title: "Demo wellness visit",
      appointment_type: "veterinary",
      starts_at: "2027-10-10T14:00:00Z",
      ends_at: "2027-10-10T14:30:00Z",
      status: "scheduled",
    });
  }
  private check(c: SchedulingConnection) {
    assertMockEnabled();
    if (c.id !== this.connectionId || c.externalSystem !== "mock")
      throw new Error("Connection mismatch");
  }
  async validateConnection(c: SchedulingConnection) {
    this.check(c);
    return true;
  }
  async getConnectionMetadata(c: SchedulingConnection) {
    this.check(c);
    return { label: "Demo Scheduling System" };
  }
  async listExternalPets(c: SchedulingConnection) {
    this.check(c);
    return [
      {
        externalId: "demo-pet",
        externalOwnerId: "demo-owner",
        label: "Demo pet (fictional)",
      },
    ];
  }
  async listAppointments(
    c: SchedulingConnection,
    w: { from: string; to: string },
  ) {
    this.check(c);
    return {
      appointments: [...this.appointments.values()]
        .filter(
          (a) =>
            Date.parse(a.starts_at) >= Date.parse(w.from) &&
            Date.parse(a.starts_at) <= Date.parse(w.to),
        )
        .map((a) => ({ ...a })),
    };
  }
  async getAppointment(c: SchedulingConnection, id: string) {
    this.check(c);
    const a = this.appointments.get(id);
    return a ? { ...a } : null;
  }
  normalizeAppointment(a: unknown, eventId: string) {
    assertMockEnabled();
    const v = a as ExternalAppointment;
    return schedulingEventSchema.parse({
      event_id: eventId,
      kind: "upsert",
      external_id: v.externalId,
      external_pet_id: v.externalPetReference,
      version: v.version,
      title: v.title,
      appointment_type: v.appointment_type,
      starts_at: v.starts_at,
      ends_at: v.ends_at,
      status: v.status,
    });
  }
  private slots: AvailabilitySlot[] | null = null;
  setAvailability(c: SchedulingConnection, slots: AvailabilitySlot[]) {
    this.check(c);
    this.slots = slots.map((s) => ({ ...s }));
  }
  async listAvailability(
    c: SchedulingConnection,
    query?: { from: string; to: string },
  ) {
    this.check(c);
    const slots = this.slots || [
      {
        connectionId: c.id,
        appointmentType: "veterinary" as const,
        bookable: true,
        externalSlotId: "demo-slot",
        startsAt: "2027-10-10T14:00:00Z",
        endsAt: "2027-10-10T14:30:00Z",
        externalServiceId: "demo-wellness",
        externalResourceId: "demo-room",
      },
    ];
    return slots
      .filter(
        (s) =>
          !query ||
          (Date.parse(s.startsAt) >= Date.parse(query.from) &&
            Date.parse(s.startsAt) <= Date.parse(query.to)),
      )
      .map((s) => ({ ...s }));
  }
  updateAppointment(
    c: SchedulingConnection,
    id: string,
    change: Partial<
      Pick<ExternalAppointment, "starts_at" | "ends_at" | "status">
    >,
  ) {
    this.check(c);
    const a = this.appointments.get(id);
    if (!a) throw new Error("Not found");
    const next = { ...a, ...change, version: a.version + 1 };
    this.normalizeAppointment(next, `demo-${next.version}`);
    this.appointments.set(id, next);
  }
  async cancelAppointment(c: SchedulingConnection, id: string) {
    this.check(c);
    if (this.appointments.get(id)?.status !== "cancelled")
      this.updateAppointment(c, id, { status: "cancelled" });
  }
  signDemoEvent(
    c: SchedulingConnection,
    event: SchedulingEvent,
    timestamp = Math.floor(this.clock() / 1000),
  ): WebhookRequest {
    this.check(c);
    const body = Buffer.from(JSON.stringify(event));
    const signature = createHmac("sha256", this.key)
      .update(`${c.id}.${timestamp}.`)
      .update(body)
      .digest("hex");
    return {
      body,
      headers: {
        "x-demo-timestamp": String(timestamp),
        "x-demo-signature": signature,
      },
    };
  }
  async verifyWebhook(
    c: SchedulingConnection,
    r: WebhookRequest,
  ): Promise<VerifiedWebhook> {
    this.check(c);
    if (r.body.byteLength > 32768) throw new Error("Invalid webhook");
    const t = r.headers["x-demo-timestamp"];
    const sig = r.headers["x-demo-signature"];
    if (
      !/^\d{10}$/.test(t || "") ||
      Math.abs(this.clock() / 1000 - Number(t)) > 300 ||
      !/^[a-f0-9]{64}$/.test(sig || "")
    )
      throw new Error("Invalid webhook");
    const expected = createHmac("sha256", this.key)
      .update(`${c.id}.${t}.`)
      .update(r.body)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(sig, "hex")))
      throw new Error("Invalid webhook");
    const v = {
      event: schedulingEventSchema.parse(
        JSON.parse(Buffer.from(r.body).toString("utf8")),
      ),
    };
    this.verified.add(v);
    return v;
  }
  normalizeWebhookEvent(v: VerifiedWebhook) {
    assertMockEnabled();
    if (!this.verified.has(v)) throw new Error("Unverified webhook");
    this.verified.delete(v);
    return schedulingEventSchema.parse(v.event);
  }
}
