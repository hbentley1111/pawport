import { NextRequest } from "next/server";
import { searchSchema } from "@/lib/services/schema";
import { googlePlaces } from "@/lib/services/server";
import {
  serviceSession,
  serviceJson,
  serviceError,
  smallJson,
} from "@/lib/services/http";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return serviceJson({ error: "Invalid request origin." }, 403);
  try {
    const input = searchSchema.parse(await smallJson(request));
    const { db } = await serviceSession("search");
    const places = await googlePlaces().search(input);
    const { data, error } = await db.rpc("service_community_summaries", {
      p_places: places.map((p) => p.id),
    });
    return serviceJson({ places, community: error ? null : data });
  } catch (error) {
    return serviceError(error);
  }
}
