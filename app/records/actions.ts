"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
async function session() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  return db;
}
function refresh() {
  revalidatePath("/records");
  revalidatePath("/provider");
  revalidatePath("/");
}
export async function attachDocument(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const db = await session();
  const parsed = z
    .object({ vaccination_id: z.uuid(), document_id: z.uuid() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Choose a record and a document." };
  const { error } = await db.rpc("attach_vaccination_document", {
    p_vaccination: parsed.data.vaccination_id,
    p_document: parsed.data.document_id,
  });
  if (error)
    return {
      error:
        "Could not attach the document. Use an uploaded document for this pet. Evidence cannot be replaced or changed during verification.",
    };
  refresh();
  return {
    success:
      "Document attached. This supports the record but does not verify it.",
  };
}
export async function requestVerification(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const db = await session();
  const parsed = z
    .object({
      vaccination_id: z.uuid(),
      provider_id: z.uuid(),
      consent: z.literal("on"),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Choose a clinic and confirm what you are sharing." };
  const { error } = await db.rpc("request_vaccination_verification", {
    p_vaccination: parsed.data.vaccination_id,
    p_provider: parsed.data.provider_id,
  });
  if (error)
    return {
      error:
        "Could not request verification. A request may already be pending or the record already verified.",
    };
  refresh();
  return { success: "Record presented to the clinic for verification." };
}
export async function verifyRecord(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const db = await session();
  const parsed = z
    .object({
      request_id: z.uuid(),
      notes: z.string().trim().max(1000),
      attest: z.literal("on"),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Confirm you verified this record. Notes must be under 1,000 characters.",
    };
  const { error } = await db.rpc("complete_vaccination_verification", {
    p_request: parsed.data.request_id,
    p_notes: parsed.data.notes,
  });
  if (error)
    return {
      error:
        "Unable to verify. You must be an active member of the requested clinic, and cannot verify your own pet’s record. The request may have changed.",
    };
  refresh();
  return {
    success: "Verification recorded with your provider identity and timestamp.",
  };
}
export async function closeVerification(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const db = await session();
  const parsed = z.uuid().safeParse(form.get("request_id"));
  if (!parsed.success) return { error: "Invalid request." };
  const { error } = await db.rpc("close_vaccination_verification", {
    p_request: parsed.data,
  });
  if (error)
    return { error: "Unable to close this request. Refresh and try again." };
  refresh();
  return {
    success: "Request closed. Access and trust status have been updated.",
  };
}
export async function finishUpload(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const db = await session();
  const id = z.uuid().safeParse(form.get("document_id"));
  if (!id.success) return { error: "Invalid document." };
  const { error } = await db.rpc("finalize_health_document", {
    p_document: id.data,
  });
  if (error)
    return {
      error:
        "No valid uploaded file was found. Upload the document again; an administrator can remove stale upload reservations.",
    };
  refresh();
  return { success: "Upload finalized." };
}
