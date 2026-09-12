import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logoInput, logoSignature } from "@/lib/business-profiles/schema";
const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const LOGO_BUCKET = "provider-profile-assets";

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
  if (error || !user) return fail("Sign in to upload a logo.", 401);
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_LOGO_BYTES + 65536)
    return fail("Choose a logo no larger than 3 MB.", 413);
  // Bound streamed bodies too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return fail("Choose a logo.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_LOGO_BYTES + 65536) {
      await reader.cancel();
      return fail("Choose a logo no larger than 3 MB.", 413);
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
  const organization = z.uuid().safeParse(form.get("organization"));
  if (!(file instanceof File) || !organization.success)
    return fail("Choose a business and logo.");
  const parsed = logoInput.safeParse({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!logoSignature(bytes, file.type))
    return fail("The file contents do not match its type.");
  const { data: logo, error: prepareError } = await db.rpc(
    "prepare_service_provider_logo",
    {
      p_organization: organization.data,
      p_name: file.name,
      p_mime: file.type,
      p_size: file.size,
    },
  );
  if (prepareError)
    return fail(
      "Unable to prepare this upload. Check business permissions or try again later.",
      403,
    );
  const { error: uploadError } = await db.storage
    .from(LOGO_BUCKET)
    .upload(logo.path, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "0",
    });
  if (uploadError)
    return fail(
      "Upload failed. Please try again. No completed logo was added.",
      502,
    );
  const { error: finalizeError } = await db.rpc(
    "finalize_service_provider_logo",
    { p_organization: organization.data, p_asset: logo.id },
  );
  if (finalizeError)
    return fail(
      "We couldn’t confirm the logo was saved. Refresh before retrying.",
      502,
    );
  revalidatePath("/provider/businesses", "layout");
  revalidatePath("/providers", "layout");
  revalidatePath("/services", "layout");
  return NextResponse.json(
    { success: "Logo saved." },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
