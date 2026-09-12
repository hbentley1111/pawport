import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, configured } from "@/lib/supabase/server";
import { validTimeZone } from "@/lib/care/time";
import { preventiveCare, preventiveSummary } from "@/lib/preventive-care/data";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" },
    zone = request.nextUrl.searchParams.get("zone") || "",
    pet = request.nextUrl.searchParams.get("pet");
  if (
    zone.length > 100 ||
    !validTimeZone(zone) ||
    (pet && !z.uuid().safeParse(pet).success)
  )
    return NextResponse.json(
      { error: "Invalid pet or time zone." },
      { status: 400, headers },
    );
  if (!configured())
    return NextResponse.json(
      { error: "Sign in to view care." },
      { status: 401, headers },
    );
  const db = await createClient();
  if (!(await db.auth.getUser()).data.user)
    return NextResponse.json(
      { error: "Sign in to view care." },
      { status: 401, headers },
    );
  try {
    return NextResponse.json(
      pet
        ? await preventiveCare(db, pet, zone)
        : await preventiveSummary(db, zone),
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Preventive care is unavailable. Your records and routines are still accessible.",
      },
      { status: 404, headers },
    );
  }
}
