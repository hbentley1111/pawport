export type BookingErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "slot_gone"
  | "invalid_mapping"
  | "vendor_error"
  | "conflict"
  | "unsupported"
  | "unknown";
export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode) {
    super(code);
    this.name = "BookingError";
  }
}
export type Catalog = {
  site: { id: string; timeZone: string };
  appointmentTypes: { id: string; name: string }[];
  resources: { id: string; name: string }[];
};
export type LiveSlot = {
  startsAt: string;
  endsAt: string;
  timeZone: string;
  resourceId: string;
  appointmentTypeId: string;
};
export type AvailabilityQuery = {
  appointmentTypeId: string;
  durationMinutes: number;
  resourceIds: string[];
  dates: string[];
  site: { id: string; timeZone: string };
};
export type BookingInput = LiveSlot & { animalId: string; contactId: string };
export type VendorAppointment = {
  id: number;
  externalAppointmentId: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  modifiedAt: number;
  animalId: string;
  contactId: string;
  appointmentTypeId: string;
  resourceIds: string[];
};
export interface LiveSchedulingAdapter {
  readonly system: "ezyvet" | "mock";
  readonly capabilities: {
    supportsAvailability: boolean;
    supportsAppointmentCreate: boolean;
    supportsAppointmentCancel?: boolean;
    supportsAppointmentReschedule?: boolean;
  };
  getCatalog(): Promise<Catalog>;
  listAvailability(query: AvailabilityQuery): Promise<LiveSlot[]>;
  validateConnection(query: AvailabilityQuery): Promise<Catalog>;
  bookAppointment(
    input: BookingInput,
  ): Promise<{ externalAppointmentId: string }>;
  getAppointment?(
    externalId: string,
    numericId?: number,
  ): Promise<VendorAppointment>;
  cancelAppointment?(
    appointment: VendorAppointment,
  ): Promise<VendorAppointment>;
  rescheduleAppointment?(): Promise<never>;
}
