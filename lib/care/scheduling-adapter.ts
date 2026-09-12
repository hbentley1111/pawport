import type { Appointment } from "./schema";
export type SchedulingSystem =
  "mock" | "ezyvet" | "daysmart" | "gingr" | "moego";
export type SchedulingConnection = {
  id: string;
  externalSystem: SchedulingSystem;
  accountReference?: string;
  locationReference?: string;
};
export type SchedulingCapabilities = {
  supportsAppointmentRead: boolean;
  supportsAppointmentCreate: boolean;
  supportsCancellation: boolean;
  supportsAvailability: boolean;
  supportsWebhooks: boolean;
  supportsPetLookup: boolean;
};
export type ExternalPet = {
  externalId: string;
  externalOwnerId?: string;
  label: string;
};
export type ExternalAppointment = Pick<
  Appointment,
  "title" | "appointment_type" | "starts_at" | "ends_at" | "status"
> & { externalId: string; externalPetReference: string; version: number };
export type SchedulingEvent = {
  event_id: string;
  kind: "upsert" | "tombstone";
  external_id: string;
  external_pet_id: string;
  version: number;
  replaces_id?: string;
  title?: string;
  appointment_type?: Appointment["appointment_type"];
  starts_at?: string;
  ends_at?: string | null;
  status?: Appointment["status"];
};
export type AvailabilitySlot = {
  connectionId: string;
  appointmentType: Appointment["appointment_type"];
  bookable: boolean;
  externalSlotId: string;
  startsAt: string;
  endsAt: string;
  externalServiceId?: string;
  externalStaffId?: string;
  externalResourceId?: string;
};
export type WebhookRequest = {
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
};
// Verified envelope is adapter-owned; transport must never normalize arbitrary JSON directly.
export type VerifiedWebhook = { readonly event: SchedulingEvent };
export interface SchedulingAdapter {
  /** Privileged booking runtimes provide this capability; ordinary Next.js adapters do not. */
  readonly liveBooking?: import("../../supabase/functions/_shared/live-booking/contract").LiveSchedulingAdapter;
  readonly system: SchedulingSystem;
  readonly capabilities: Readonly<SchedulingCapabilities>;
  validateConnection(connection: SchedulingConnection): Promise<boolean>;
  getConnectionMetadata(
    connection: SchedulingConnection,
  ): Promise<{ label: string }>;
  listExternalPets?(connection: SchedulingConnection): Promise<ExternalPet[]>;
  listAppointments?(
    connection: SchedulingConnection,
    window: { from: string; to: string; cursor?: string },
  ): Promise<{ appointments: ExternalAppointment[]; nextCursor?: string }>;
  getAppointment?(
    connection: SchedulingConnection,
    externalId: string,
  ): Promise<ExternalAppointment | null>;
  normalizeAppointment?(appointment: unknown, eventId: string): SchedulingEvent;
  listAvailability?(
    connection: SchedulingConnection,
    query: {
      type?: Appointment["appointment_type"];
      from: string;
      to: string;
      externalServiceId?: string;
      externalStaffId?: string;
      externalResourceId?: string;
    },
  ): Promise<AvailabilitySlot[]>;
  createAppointment?(
    connection: SchedulingConnection,
    input: {
      slotId: string;
      externalPetReference: string;
      idempotencyKey: string;
    },
  ): Promise<ExternalAppointment>;
  cancelAppointment?(
    connection: SchedulingConnection,
    externalId: string,
    idempotencyKey: string,
  ): Promise<void>;
  verifyWebhook?(
    connection: SchedulingConnection,
    request: WebhookRequest,
  ): Promise<VerifiedWebhook>;
  normalizeWebhookEvent?(verified: VerifiedWebhook): SchedulingEvent;
}
