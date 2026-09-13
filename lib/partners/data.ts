import "server-only";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import type { Operations } from "./schema";
export async function operatorData(
  partner: string | null = null,
  connection: string | null = null,
) {
  const { db } = await ownerSession();
  const { data, error } = await db.rpc("my_partner_operations", {
    p_partner: partner,
    p_connection: connection,
  });
  if (error || !data) notFound();
  return data as Operations;
}
