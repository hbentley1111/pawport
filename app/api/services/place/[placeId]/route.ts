import { googlePlaces } from "@/lib/services/server";
import { placeIdSchema } from "@/lib/services/schema";
import { serviceSession, serviceJson, serviceError } from "@/lib/services/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return serviceJson({ error: "Invalid request origin." }, 403);
  try {
    const id = placeIdSchema.parse((await params).placeId);
    await serviceSession("details");
    const place = await googlePlaces().details(id);
    return serviceJson({ place });
  } catch (error) {
    return serviceError(error);
  }
}
