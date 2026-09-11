import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, matchesDocumentSignature } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  const denied = () =>
    NextResponse.json(
      { error: "Document unavailable." },
      { status: 404, headers },
    );
  if (!z.uuid().safeParse(id).success) return denied();
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return denied();
  const { data: d, error: readError } = await db
    .from("health_documents")
    .select("id,object_path,original_name,mime_type,uploaded_at")
    .eq("id", id)
    .not("uploaded_at", "is", null)
    .maybeSingle();
  if (readError || !d) return denied();
  const { data: blob, error: downloadError } = await db.storage
    .from(DOCUMENT_BUCKET)
    .download(d.object_path);
  if (downloadError || !blob) return denied();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!matchesDocumentSignature(bytes, d.mime_type)) return denied();
  const { error: auditError } = await db.rpc("log_health_document_access", {
    p_document: id,
  });
  if (auditError) return denied();
  // Authenticated proxy rather than transferable signed URLs. Never execute uploaded
  // content on the app's origin; downloads are forced attachments, including PDFs.
  return new Response(bytes, {
    headers: {
      ...headers,
      "Content-Type": d.mime_type,
      "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
