import { z } from "zod";
export const categories = [
  {
    id: "vets",
    label: "Vets",
    query: "veterinarians",
    type: "veterinary_care",
  },
  { id: "emergency", label: "Emergency Vet", query: "emergency veterinarian" },
  { id: "groomers", label: "Groomers", query: "pet groomers" },
  { id: "walkers", label: "Walkers", query: "dog walkers" },
  { id: "sitters", label: "Sitters", query: "pet sitters" },
  { id: "boarding", label: "Boarding", query: "pet boarding and dog daycare" },
  { id: "trainers", label: "Trainers", query: "dog trainers" },
  {
    id: "stores",
    label: "Pet Stores",
    query: "pet supply stores",
    type: "pet_store",
  },
] as const;
export const categorySchema = z.enum([
  "vets",
  "emergency",
  "groomers",
  "walkers",
  "sitters",
  "boarding",
  "trainers",
  "stores",
]);
export const radiusSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(25),
  z.literal(50),
]);
// Google IDs are opaque, not always ChIJ-prefixed. Bound input and reject route/URL metacharacters.
export const placeIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid business identifier.");
export const zipSchema = z
  .string()
  .regex(/^\d{5}$/, "Enter a 5-digit US ZIP code.");
export const coordinatesSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const searchSchema = z
  .object({
    category: categorySchema,
    radius: radiusSchema,
    location: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("zip"), zip: zipSchema }).strict(),
      z
        .object({ kind: z.literal("device"), coordinates: coordinatesSchema })
        .strict(),
    ]),
  })
  .strict();
export const reviewSchema = z
  .object({
    placeId: placeIdSchema,
    rating: z.coerce.number().int().min(1, "Choose a star rating.").max(5),
    comment: z
      .string()
      .trim()
      .max(1500, "Keep your review to 1,500 characters."),
  })
  .strict();
export const reportSchema = z
  .object({
    reviewId: z.uuid(),
    reason: z.enum(["spam", "harassment", "privacy", "misleading", "other"]),
    details: z.string().trim().max(500),
  })
  .strict();
export const preferenceSchema = z
  .object({ postal_code: zipSchema, radius_miles: radiusSchema })
  .strict();
export type SearchInput = z.infer<typeof searchSchema>;
export type Coordinates = z.infer<typeof coordinatesSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CommunityRating = { average: number | null; count: number };
export type Place = {
  id: string;
  name: string;
  category: string;
  address: string | null;
  googleRating: number | null;
  googleReviewCount: number;
  openNow: boolean | null;
  businessStatus: string | null;
  distanceMiles: number | null;
  serviceArea: boolean;
  mapsUrl: string;
  attributions: { name: string; url: string | null }[];
  hours?: string[];
  phone?: string | null;
  website?: string | null;
};
export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
  reviewer: "Pawport Member";
};
export type ReviewPage = {
  summary: CommunityRating;
  reviews: PublicReview[];
  hasMore: boolean;
};
export type OwnReview = {
  id: string;
  rating: number;
  comment: string | null;
  deleted_at: string | null;
  hidden: boolean;
} | null;
export type SearchResult = {
  places: Place[];
  community: Record<string, CommunityRating> | null;
};
export function servicePath(id: string) {
  return `/services/${encodeURIComponent(placeIdSchema.parse(id))}`;
}
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
