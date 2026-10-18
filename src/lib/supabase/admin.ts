import { createClient } from "@supabase/supabase-js";

/** Server-only privileged client for verified payment settlement and sandbox checkout binding. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { db: { schema: "businesshub" }, auth: { persistSession: false, autoRefreshToken: false } });
}
