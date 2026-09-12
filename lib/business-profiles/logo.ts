import "server-only";
import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { logoSignature } from "./schema";
export async function deliverLogo(id: string, member = false) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  const denied = () => new Response(null, { status: 404, headers });
  if (!configured() || !z.uuid().safeParse(id).success) return denied();
  const db = await createClient();
  if (member) {
    const r = await db.auth.getUser();
    if (r.error || !r.data.user) return denied();
  }
  const { data, error } = await db.rpc(
    "service_provider_logo_delivery",
    member ? { p_organization: id } : { p_location: id },
  );
  const asset = z
    .object({
      key: z.uuid(),
      mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
      size: z.number().int().min(1).max(3145728),
    })
    .safeParse(data);
  if (error || !asset.success) return denied();
  const { data: blob, error: downloadError } = await db.storage
    .from("provider-profile-assets")
    .download(`logos/${asset.data.key}`);
  if (downloadError || !blob || blob.size !== asset.data.size) return denied();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!logoSignature(bytes, asset.data.mime)) return denied();
  // Recheck publication/member access after download, including concurrent unpublish.
  const check = await db.rpc(
    "service_provider_logo_delivery",
    member ? { p_organization: id } : { p_location: id },
  );
  if (check.error || check.data?.key !== asset.data.key) return denied();
  return new Response(bytes, {
    headers: {
      ...headers,
      "Content-Type": asset.data.mime,
      "Content-Disposition": "inline",
    },
  });
}
