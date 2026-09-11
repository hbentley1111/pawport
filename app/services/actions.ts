"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { serviceSession } from "@/lib/services/http";
import { PlacesError } from "@/lib/services/google-client";
import {
  placeIdSchema,
  reviewSchema,
  reportSchema,
  preferenceSchema,
} from "@/lib/services/schema";
export type ServiceActionState = {
  error?: string;
  success?: string;
  saved?: boolean;
};
function failure(error: unknown): ServiceActionState {
  return {
    error:
      error instanceof PlacesError
        ? error.message
        : "We couldn’t save this change. Please try again.",
  };
}
function refresh(placeId?: string) {
  revalidatePath("/services");
  if (placeId) revalidatePath(`/services/${placeId}`);
}
export async function saveReview(
  _: ServiceActionState,
  form: FormData,
): Promise<ServiceActionState> {
  const parsed = reviewSchema.safeParse({
    placeId: form.get("placeId"),
    rating: form.get("rating"),
    comment: form.get("comment"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const { db } = await serviceSession("write");
    const { error } = await db.rpc("save_service_review", {
      p_place: parsed.data.placeId,
      p_rating: parsed.data.rating,
      p_comment: parsed.data.comment,
    });
    if (error)
      return {
        error:
          "Unable to save your review. You may have reached the daily limit, or this review may be under moderation.",
      };
    refresh(parsed.data.placeId);
    return { success: "Your Pawport review has been saved." };
  } catch (error) {
    return failure(error);
  }
}
export async function withdrawReview(
  _: ServiceActionState,
  form: FormData,
): Promise<ServiceActionState> {
  const parsed = z
    .object({ id: z.uuid(), placeId: placeIdSchema })
    .safeParse({ id: form.get("id"), placeId: form.get("placeId") });
  if (!parsed.success) return { error: "Invalid review." };
  try {
    const { db } = await serviceSession("write");
    const { error } = await db.rpc("withdraw_service_review", {
      p_review: parsed.data.id,
    });
    if (error) return { error: "Unable to withdraw this review." };
    refresh(parsed.data.placeId);
    return { success: "Your review is no longer published." };
  } catch (error) {
    return failure(error);
  }
}
export async function setFavorite(
  _: ServiceActionState,
  form: FormData,
): Promise<ServiceActionState> {
  const parsed = z
    .object({ placeId: placeIdSchema, saved: z.enum(["true", "false"]) })
    .safeParse({ placeId: form.get("placeId"), saved: form.get("saved") });
  if (!parsed.success) return { error: "Invalid saved place." };
  try {
    const { db } = await serviceSession("write"),
      saved = parsed.data.saved === "true";
    const { error } = await db.rpc("set_service_favorite", {
      p_place: parsed.data.placeId,
      p_saved: saved,
    });
    if (error)
      return {
        error: "Could not update saved places. You can save up to 100.",
      };
    refresh(parsed.data.placeId);
    return {
      saved,
      success: saved
        ? "Place saved privately."
        : "Place removed from saved places.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function savePreference(
  _: ServiceActionState,
  form: FormData,
): Promise<ServiceActionState> {
  const forget = form.get("forget") === "true";
  const parsed = preferenceSchema.safeParse({
    postal_code: form.get("postal_code"),
    radius_miles: Number(form.get("radius_miles")),
  });
  if (!forget && !parsed.success)
    return { error: "Enter a 5-digit ZIP and choose a supported radius." };
  try {
    const { db } = await serviceSession("write");
    const { error } = await db.rpc("set_service_preference", {
      p_postal: forget ? null : parsed.data!.postal_code,
      p_radius: forget ? 10 : parsed.data!.radius_miles,
    });
    if (error) return { error: "Could not update your preferred area." };
    refresh();
    return {
      success: forget
        ? "Preferred area removed."
        : "ZIP and radius remembered for your account.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function reportReview(
  _: ServiceActionState,
  form: FormData,
): Promise<ServiceActionState> {
  const parsed = reportSchema.safeParse({
    reviewId: form.get("reviewId"),
    reason: form.get("reason"),
    details: form.get("details"),
  });
  if (!parsed.success)
    return {
      error: "Choose a report reason and keep details under 500 characters.",
    };
  try {
    const { db } = await serviceSession("write");
    const { error } = await db.rpc("report_service_review", {
      p_review: parsed.data.reviewId,
      p_reason: parsed.data.reason,
      p_details: parsed.data.details,
    });
    if (error)
      return {
        error:
          "Unable to submit. You may have already reported this review, reached the daily limit, or the review is no longer published.",
      };
    return { success: "Report received. A moderator will review it." };
  } catch (error) {
    return failure(error);
  }
}
