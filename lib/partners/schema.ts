export const partnerCapabilities = [
  "scheduling.catalog.read",
  "scheduling.availability.read",
  "scheduling.appointment.read",
  "scheduling.appointment.book",
  "scheduling.appointment.cancel",
  "partner.health.readiness",
  "webhook.receive",
] as const;
export const partnerTypes = [
  "pharmacy",
  "laboratory",
  "insurance_carrier",
  "practice_management",
  "grooming",
  "boarding",
  "training",
  "pet_retail",
  "other",
];
export type Row = Record<string, string | number | boolean | null>;
export type Operations = {
  role: "operator" | "admin";
  runtime: { sandboxEnabled: boolean; productionEnabled: boolean };
  partners: Row[];
  connections: Row[];
  capabilities: Row[];
  grants: Row[];
  events: Row[];
  activation: Row[];
  audit: Row[];
  pilots: Row[];
  pilotTarget: number;
  pilotCounts: Record<string, number>;
};
export type Consent = {
  id: string;
  partnerName: string;
  status: string;
  environment: string;
  grants: {
    category: string;
    purpose: string;
    direction: string;
    expiresAt: string | null;
  }[];
};
