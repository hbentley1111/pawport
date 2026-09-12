import { z } from "zod";
import { wallTimeToISO } from "@/lib/care/time";
export type Intake = {
  locationId: string;
  businessName: string;
  locationName: string;
  timeZone: string;
  instructions: string | null;
  minimumNoticeHours: number;
  maximumAdvanceDays: number;
  services: {
    id: string;
    name: string;
    category: string;
    description: string | null;
  }[];
};
export type RequestItem = {
  requestId: string;
  petId?: string;
  petName: string;
  species?: string;
  businessName: string;
  locationName: string;
  serviceName: string;
  timeZone: string;
  status: string;
  preferredWindows: { startsAt: string; endsAt: string }[];
  proposal: null | {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    message: string | null;
    expiresAt: string;
  };
  responseNote: string | null;
  appointmentId?: string | null;
  appointment?: { startsAt: string; endsAt: string; status: string } | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  note?: string;
  createdAt: string;
  expiresAt: string;
  history: {
    id: string;
    type: string;
    message: string | null;
    createdAt: string;
  }[];
};
export type RequestSettings = {
  locationId: string;
  settings: {
    requests_enabled: boolean;
    instructions?: string;
    minimum_notice_hours: number;
    maximum_advance_days: number;
  };
  services: { id: string; name: string; enabled: boolean }[];
};
export const requestInput = z
  .object({
    pet: z.uuid(),
    location: z.uuid(),
    service: z.uuid(),
    contactName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40),
    note: z.string().trim().max(1000),
    windows: z
      .array(
        z
          .object({ start: z.string().max(16), end: z.string().max(16) })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export function normalizeWindows(
  windows: { start: string; end: string }[],
  zone: string,
) {
  return windows.map((w) => ({
    starts_at: wallTimeToISO(w.start, zone),
    ends_at: wallTimeToISO(w.end, zone),
  }));
}
export function requestLabel(status: string) {
  return (
    (
      {
        requested: "Waiting for business",
        provider_proposed: "Time proposal to review",
        confirmed: "Confirmed",
        declined: "Declined",
        withdrawn: "Withdrawn",
        cancelled_by_owner: "Cancelled by owner",
        cancelled_by_provider: "Cancelled by business",
        expired: "Expired",
      } as Record<string, string>
    )[status] || status.replaceAll("_", " ")
  );
}
