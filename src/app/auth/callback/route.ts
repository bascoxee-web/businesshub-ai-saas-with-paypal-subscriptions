import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

// Email-confirmation links land here with a one-time code that we swap for a session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = await siteUrl();
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${searchParams.get("next") === "/reset-password" ? "/reset-password" : "/app"}`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That confirmation link didn't work. Try signing in.")}`);
}
