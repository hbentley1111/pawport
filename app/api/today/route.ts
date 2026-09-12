import { NextRequest, NextResponse } from "next/server";
import { createClient, configured } from "@/lib/supabase/server";
import { getPawportToday } from "@/lib/today/data";
import { validTimeZone } from "@/lib/care/time";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const zone = request.nextUrl.searchParams.get("zone") || "";
  if (zone.length > 100 || !validTimeZone(zone) || !zone)
    return NextResponse.json(
      { error: "Choose a valid time zone." },
      { status: 400, headers },
    );
  if (!configured())
    return NextResponse.json(
      { error: "Sign in to view Today." },
      { status: 401, headers },
    );
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to view Today." },
      { status: 401, headers },
    );
  try {
    return NextResponse.json(await getPawportToday(db, zone), { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Today is temporarily unavailable. Your pets and records are still accessible.",
      },
      { status: 503, headers },
    );
  }
}
