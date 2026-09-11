import { z } from "zod";
import { serviceSession, serviceJson, serviceError } from "@/lib/services/http";
import { googlePlaces } from "@/lib/services/server";
import { PlacesError } from "@/lib/services/google-client";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return serviceJson({ error: "Invalid request origin." }, 403);
  try {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(99)
      .parse(new URL(request.url).searchParams.get("offset") || 0);
    const { db } = await serviceSession("search");
    const { data, error } = await db
      .from("service_favorites")
      .select("google_place_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("google_place_id")
      .range(offset, offset + 6);
    if (error)
      return serviceJson(
        { error: "Saved places are unavailable. Please try again." },
        503,
      );
    const ids = (data || []).slice(0, 6).map((p) => p.google_place_id);
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return { placeId: id, place: await googlePlaces().details(id) };
        } catch (error) {
          if (error instanceof PlacesError && error.code === "not_found")
            return { placeId: id, place: null };
          throw error;
        }
      }),
    );
    const summary = await db.rpc("service_community_summaries", {
      p_places: ids,
    });
    return serviceJson({
      entries,
      community: summary.error ? null : summary.data,
      hasMore: (data?.length || 0) > 6,
    });
  } catch (error) {
    return serviceError(error);
  }
}
