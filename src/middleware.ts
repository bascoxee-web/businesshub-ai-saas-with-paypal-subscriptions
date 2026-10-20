import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static files, the public invoice pages and the PayPal webhook; everything else refreshes the session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|i/|api/paypal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
