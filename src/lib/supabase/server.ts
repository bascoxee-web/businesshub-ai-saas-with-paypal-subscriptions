import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for server components, server actions and route handlers.
 *  It acts as the signed-in user, so row-level security applies to every query. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    db: { schema: "businesshub" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component: the middleware refreshes the session instead.
        }
      },
    },
  });
}
