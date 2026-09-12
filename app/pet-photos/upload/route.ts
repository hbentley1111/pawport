import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { photoSchema, PHOTO_BUCKET, MAX_PHOTO_BYTES } from "@/lib/pets";
import { matchesDocumentSignature } from "@/lib/records";
export const runtime = "nodejs";
function fail(error: string, status = 400) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: NextRequest) {
  // Route handlers do not inherit Server Action CSRF checks.
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return fail("Invalid request origin.", 403);
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return fail("Sign in to upload a photo.", 401);
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_PHOTO_BYTES + 65536)
    return fail("Choose a photo no larger than 3 MB.", 413);
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return fail("Choose a photo.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PHOTO_BYTES + 65536) {
      await reader.cancel();
      return fail("Choose a photo no larger than 3 MB.", 413);
    }
    chunks.push(value);
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    return fail("Invalid upload.");
  }
  const purpose = z
    .enum(["profile", "journal"])
    .safeParse(form.get("purpose") || "profile");
  if (!purpose.success) return fail("Invalid photo purpose.");
  const file = form.get("file");
  const pet = z.uuid().safeParse(form.get("pet_id"));
  if (!(file instanceof File) || !pet.success)
    return fail("Choose a pet and photo.");
  const parsed = photoSchema.safeParse({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesDocumentSignature(bytes, file.type))
    return fail("The file contents do not match its type.");
  const { data: photo, error: prepareError } = await db.rpc(
    "prepare_pet_photo",
    {
      p_pet: pet.data,
      p_name: file.name,
      p_mime: file.type,
      p_size: file.size,
    },
  );
  if (prepareError)
    return fail(
      "Unable to prepare this upload. Check pet ownership or try again later.",
      403,
    );
  const { error: uploadError } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(photo.path, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "0",
    });
  if (uploadError)
    return fail(
      "Upload failed. Please try again. No completed photo was added.",
      502,
    );
  const { data: finalized, error: finalizeError } = await db.rpc(
    purpose.data === "journal"
      ? "finalize_journal_photo"
      : "finalize_pet_photo",
    {
      p_photo: photo.id,
    },
  );
  if (finalizeError)
    return fail(
      "We couldn’t confirm the photo was saved. Refresh to check before retrying.",
      502,
    );
  // Retired objects cannot become current again. Cleanup cannot delete a concurrent replacement.
  let cleanupFailed = false;
  if (finalized?.previous_path) {
    const { error: cleanupError } = await db.storage
      .from(PHOTO_BUCKET)
      .remove([finalized.previous_path]);
    cleanupFailed = Boolean(cleanupError);
  }
  revalidatePath("/");
  revalidatePath(`/pets/${pet.data}`, "layout");
  return NextResponse.json(
    {
      ...(purpose.data === "journal" ? { photo_id: photo.id } : {}),
      success:
        purpose.data === "journal"
          ? "Photo uploaded. Save your moment to add it to the timeline."
          : cleanupFailed
            ? "Profile photo saved. The previous file is no longer displayed; its storage cleanup will need a retry by an administrator."
            : "Profile photo saved.",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
