import type { Appointment } from "./schema";
// Contract only. No implementation, credential, network request or booking call in Phase 5A.
export type SchedulingConnection = {
  id: string;
  householdId: string;
  externalSystem: string;
  providerReference: string;
  locationReference?: string;
};
export type ExternalAppointment = Pick<
  Appointment,
  "title" | "appointment_type" | "starts_at" | "ends_at" | "status"
> & { externalId: string; externalPetReference: string; connectionId: string };
export type AvailabilitySlot = {
  externalSlotId: string;
  startsAt: string;
  endsAt: string;
};
export interface SchedulingAdapter {
  listAppointments(
    connection: SchedulingConnection,
    window: { from: string; to: string; cursor?: string },
  ): Promise<{ appointments: ExternalAppointment[]; nextCursor?: string }>;
  getAppointment(
    connection: SchedulingConnection,
    externalId: string,
  ): Promise<ExternalAppointment | null>;
  listAvailability(
    connection: SchedulingConnection,
    query: { type: Appointment["appointment_type"]; from: string; to: string },
  ): Promise<AvailabilitySlot[]>;
  createAppointment(
    connection: SchedulingConnection,
    input: {
      slotId: string;
      externalPetReference: string;
      idempotencyKey: string;
    },
  ): Promise<ExternalAppointment>;
  cancelAppointment(
    connection: SchedulingConnection,
    externalId: string,
    idempotencyKey: string,
  ): Promise<void>;
}
