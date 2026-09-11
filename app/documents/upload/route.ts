import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  documentSchema,
  matchesDocumentSignature,
  DOCUMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
} from "@/lib/records";
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
  if (error || !user) return fail("Sign in to upload a document.", 401);
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_DOCUMENT_BYTES + 65536)
    return fail("Choose a document no larger than 3 MB.", 413);
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return fail("Choose a document.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DOCUMENT_BYTES + 65536) {
      await reader.cancel();
      return fail("Choose a document no larger than 3 MB.", 413);
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
  const file = form.get("file");
  const pet = z.uuid().safeParse(form.get("pet_id"));
  if (!(file instanceof File) || !pet.success)
    return fail("Choose a pet and document.");
  const parsed = documentSchema.safeParse({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesDocumentSignature(bytes, file.type))
    return fail("The file contents do not match its type.");
  const { data: document, error: prepareError } = await db.rpc(
    "prepare_health_document",
    {
      p_pet: pet.data,
      p_name: file.name,
      p_mime: file.type,
      p_size: file.size,
    },
  );
  if (prepareError)
    return fail(
      "Unable to prepare this upload. Check pet ownership and the 100-document limit.",
      403,
    );
  const { error: uploadError } = await db.storage
    .from(DOCUMENT_BUCKET)
    .upload(document.path, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "0",
    });
  if (uploadError)
    return fail(
      "Upload failed. Please try again. No completed document was added.",
      502,
    );
  const { error: finalizeError } = await db.rpc("finalize_health_document", {
    p_document: document.id,
  });
  if (finalizeError)
    return fail(
      "The file uploaded but could not be finalized. Use “Finish upload” in your document library to retry.",
      502,
    );
  revalidatePath("/records");
  return NextResponse.json(
    {
      success: "Document uploaded privately. Attach it to a vaccination below.",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
