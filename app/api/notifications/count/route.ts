import { NextResponse } from "next/server";
import { createClient, configured } from "@/lib/supabase/server";
import { demoNotifications } from "@/lib/notifications/data";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  if (!configured())
    return NextResponse.json({ error: "Sign in." }, { status: 401, headers });
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sign in." }, { status: 401, headers });
  const r = await db.rpc("my_notification_count", {
    p_demo: demoNotifications(),
  });
  return NextResponse.json(
    r.error
      ? { error: "Notifications unavailable." }
      : { count: Number(r.data) },
    { status: r.error ? 503 : 200, headers },
  );
}
