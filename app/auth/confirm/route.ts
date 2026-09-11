import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const db = await createClient();
  const token_hash = params.get("token_hash");
  const code = params.get("code");
  if (token_hash && params.get("type") === "email") {
    const { error } = await db.auth.verifyOtp({ token_hash, type: "email" });
    if (!error)
      return NextResponse.redirect(new URL("/onboarding", request.url));
  } else if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/onboarding", request.url));
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", request.url),
  );
}
