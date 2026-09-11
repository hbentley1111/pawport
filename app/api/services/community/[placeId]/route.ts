import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { placeIdSchema } from "@/lib/services/schema";
import { serviceJson, serviceError } from "@/lib/services/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) {
  try {
    const id = placeIdSchema.parse((await params).placeId);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000)
      .parse(new URL(request.url).searchParams.get("offset") || 0);
    if (!configured())
      return serviceJson(
        { error: "Community reviews are not configured yet." },
        503,
      );
    const db = await createClient();
    const { data, error } = await db.rpc("read_service_reviews", {
      p_place: id,
      p_offset: offset,
    });
    if (error)
      return serviceJson(
        { error: "Community reviews are temporarily unavailable." },
        503,
      );
    return serviceJson(data);
  } catch (error) {
    return serviceError(error);
  }
}
