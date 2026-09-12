import { z } from "zod";
export const categories = [
  "veterinary",
  "emergency_veterinary",
  "grooming",
  "walking",
  "sitting",
  "boarding",
  "training",
  "daycare",
  "retail",
  "other",
] as const;
export const profileTrust =
  "This profile is managed by a representative of the business. Claiming does not indicate veterinary credential verification or Pawport endorsement.";
const text = (max: number) => z.string().trim().max(max).default("");
export const website = text(2048).refine(
  (v) =>
    !v ||
    (/^https?:\/\/[^\s/?#@:]+(?::[0-9]{1,5})?(?:[/?#][^\s]*)?$/i.test(v) &&
      !/[\\\x00-\x1f]/.test(v)),
  "Enter an http:// or https:// website without login credentials.",
);
const phone = text(40).refine(
  (v) => !v || /^[0-9+(). xX#-]+$/.test(v),
  "Enter a phone number using standard formatting.",
);
export const organizationInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    tagline: text(160),
    description: text(3000),
    website_url: website,
    public_email: text(254).refine(
      (v) => !v || /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(v),
      "Enter a valid public email.",
    ),
    public_phone: phone,
  })
  .strict();
export const locationInput = z
  .object({
    display_name: text(160),
    address_line1: text(160),
    address_line2: text(160),
    city: text(100),
    region: text(100),
    postal_code: text(30),
    country_code: text(2).refine(
      (v) => !v || /^[A-Z]{2}$/.test(v),
      "Use a two-letter uppercase country code.",
    ),
    public_phone: phone,
    website_url: website,
    time_zone: text(100).refine((v) => {
      if (!v) return true;
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Enter a valid IANA timezone."),
  })
  .strict();
export const serviceInput = z
  .object({
    category: z.enum(categories),
    name: z.string().trim().min(1).max(120),
    description: text(500),
    display_order: z.coerce.number().int().min(0).max(1000),
  })
  .strict();
export const logoInput = z
  .object({
    name: z.string().min(1).max(255),
    type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(3 * 1024 * 1024),
  })
  .refine(
    (v) =>
      v.type === "image/jpeg"
        ? /\.(jpe?g)$/i.test(v.name)
        : v.type === "image/png"
          ? /\.png$/i.test(v.name)
          : /\.webp$/i.test(v.name),
    "The file extension must match its image type.",
  );
export function logoSignature(bytes: Uint8Array, mime: string) {
  return mime === "image/png"
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    : mime === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === "image/webp" &&
        bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}
export type Hours = {
  day_of_week: number;
  slot: number;
  opens_at: string | null;
  closes_at: string | null;
  is_24_hours: boolean;
};
export type BusinessService = {
  id: string;
  category: (typeof categories)[number];
  name: string;
  description: string | null;
  display_order: number;
};
export type PublicProfile = {
  locationId: string;
  googlePlaceId: string;
  businessName: string;
  locationName: string | null;
  claimed: boolean;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
  };
  timeZone: string | null;
  hoursProvided: boolean;
  hours: Hours[];
  services: BusinessService[];
  logoUrl: string | null;
  sourceLabel: string;
};
export type Business = {
  id: string;
  name: string;
  status: string;
  role: string;
  locations: {
    id: string;
    name: string | null;
    status: string;
    profileStatus: string;
  }[];
};
export type LocationEditor = {
  id: string;
  status: string;
  profileStatus: string;
  fields: Record<keyof z.infer<typeof locationInput>, string | null>;
  preview: PublicProfile;
};
export type ProfileEditor = {
  id: string;
  name: string;
  canEdit: boolean;
  tagline: string | null;
  description: string | null;
  website_url: string | null;
  public_email: string | null;
  public_phone: string | null;
  logoUrl: string | null;
  locations: LocationEditor[];
};
export const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Disabled controls are absent from FormData when the provider clears the schedule.
export function parseHoursForm(form: FormData): {
  provided: boolean;
  hours: Hours[];
} {
  const provided = form.get("hours_provided") === "yes";
  if (!provided) return { provided: false, hours: [] };
  const hours: Hours[] = [];
  for (let day = 0; day < 7; day++) {
    const mode = form.get(`day_${day}`);
    if (mode === "24")
      hours.push({
        day_of_week: day,
        slot: 1,
        opens_at: null,
        closes_at: null,
        is_24_hours: true,
      });
    else if (mode === "open") {
      for (let slot = 1; slot <= 2; slot++) {
        const opens_at = String(form.get(`open_${day}_${slot}`) || ""),
          closes_at = String(form.get(`close_${day}_${slot}`) || "");
        if (slot === 1 || opens_at || closes_at) {
          if (
            !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(opens_at) ||
            !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(closes_at) ||
            opens_at >= closes_at
          )
            throw new Error("Invalid hours");
          hours.push({
            day_of_week: day,
            slot,
            opens_at,
            closes_at,
            is_24_hours: false,
          });
        }
      }
    } else if (mode !== "closed") throw new Error("Missing day");
  }
  return { provided, hours };
}
