import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { PHOTO_BUCKET, MAX_PHOTO_BYTES } from "@/lib/pets";
import { matchesDocumentSignature } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ petId: string; entryId: string }> },
) {
  const { petId, entryId } = await params;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  const denied = () =>
    Response.json({ error: "Photo unavailable." }, { status: 404, headers });
  if (
    !configured() ||
    !z.uuid().safeParse(petId).success ||
    !z.uuid().safeParse(entryId).success
  )
    return denied();
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return denied();
  const { data: entry, error: entryError } = await db.rpc(
    "my_pet_journal_entry",
    { p_pet: petId, p_id: entryId },
  );
  if (entryError || !entry?.photo_id) return denied();
  const { data: photo, error: photoError } = await db
    .from("pet_photo_uploads")
    .select("object_path,mime_type,byte_size")
    .eq("id", entry.photo_id)
    .eq("pet_id", petId)
    .in("status", ["current", "journal", "retired"])
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
