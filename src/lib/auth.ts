import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Workspace = { id: string; name: string; plan: string; currency: string };

/** Signed-in user plus their workspace, or null. For API routes, which answer with a status code. */
export async function getWorkspaceOrNull() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Row-level security means this only ever returns workspaces the user belongs to.
  const { data: ws } = await supabase.from("workspaces").select("id, name, plan, currency").limit(1).maybeSingle();
  if (!ws) return null;
  const { data: plan } = await supabase.rpc("effective_billing_plan", { p_workspace: ws.id });
  return { supabase, user, ws: { ...ws, plan: typeof plan === "string" ? plan : "free" } as Workspace };
}

/** Signed-in user plus their workspace. Anyone else is sent to the login page. */
export async function requireWorkspace() {
  const session = await getWorkspaceOrNull();
  if (!session) {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    redirect(user ? "/onboarding" : "/login");
  }
  return session;
}

/** Redirects back to a page with an error message shown at the top. */
export function failTo(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
