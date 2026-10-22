import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const privatePage = /^\/(app|api|i|dashboard|onboarding|login|signup|forgot-password|reset-password|auth)(\/|$)/.test(request.nextUrl.pathname);
  if (process.env.ALLOW_INDEXING !== 'true' || privatePage) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  // Skip static files, the public invoice pages and the PayPal webhook; everything else refreshes the session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|i/|api/paypal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
