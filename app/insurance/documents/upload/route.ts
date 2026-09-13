import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { matchesDocumentSignature } from "@/lib/records";
const DOCUMENT_BUCKET = "insurance-documents",
  MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
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
    return fail("Choose a document no larger than 10 MiB.", 413);
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
      return fail("Choose a document no larger than 10 MiB.", 413);
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
  const file = form.get("file"),
    pet = z.uuid().safeParse(form.get("pet")),
    plan = z.uuid().safeParse(form.get("plan"));
  if (
    !(file instanceof File) ||
    !pet.success ||
    !plan.success ||
    file.size < 1 ||
    file.size > MAX_DOCUMENT_BYTES ||
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
  )
    return fail("Choose a PDF, JPEG or PNG of up to 10 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesDocumentSignature(bytes, file.type))
    return fail("The file contents do not match its type.");
  const { data: document, error: prepareError } = await db.rpc(
    "prepare_coverage_document",
    {
      p_pet: pet.data,
      p_plan: plan.data,
      p_name: file.name,
      p_type: String(form.get("document_type")),
      p_mime: file.type,
      p_size: file.size,
    },
  );
  if (prepareError || !document)
    return fail(
      "Unable to prepare this document. Check ownership and upload limits.",
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
    return fail("Upload failed. No ready document was added.", 502);
  const { error: finalizeError } = await db.rpc("finalize_coverage_document", {
    p_document: document.id,
  });
  if (finalizeError)
    return fail(
      "Uploaded but not finalized. Use Finish upload in the document list.",
      502,
    );
  revalidatePath(`/pets/${pet.data}/insurance/${plan.data}`);
  return NextResponse.json(
    { id: document.id },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
