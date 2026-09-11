import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { PHOTO_BUCKET, MAX_PHOTO_BYTES } from "@/lib/pets";
import { matchesDocumentSignature } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ petId: string }> },
) {
  const { petId } = await params;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  const denied = () =>
    Response.json({ error: "Photo unavailable." }, { status: 404, headers });
  if (!configured() || !z.uuid().safeParse(petId).success) return denied();
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return denied();
  const { data: pet, error: pError } = await db
    .from("pets")
    .select("photo_id")
    .eq("id", petId)
    .maybeSingle();
  if (pError || !pet?.photo_id) return denied();
  const { data: photo, error: photoError } = await db
    .from("pet_photo_uploads")
    .select("object_path,mime_type,byte_size")
    .eq("id", pet.photo_id)
    .eq("pet_id", petId)
    .eq("status", "current")
    .maybeSingle();
  if (photoError || !photo) return denied();
  const { data: blob, error: downloadError } = await db.storage
    .from(PHOTO_BUCKET)
    .download(photo.object_path);
  if (
    downloadError ||
    !blob ||
    blob.size > MAX_PHOTO_BYTES ||
    blob.size !== photo.byte_size
  )
    return denied();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    !["image/jpeg", "image/png"].includes(photo.mime_type) ||
    !matchesDocumentSignature(bytes, photo.mime_type)
  )
    return denied();
  return new Response(bytes, {
    headers: {
      ...headers,
      "Content-Type": photo.mime_type,
      "Content-Disposition": "inline",
    },
  });
}
