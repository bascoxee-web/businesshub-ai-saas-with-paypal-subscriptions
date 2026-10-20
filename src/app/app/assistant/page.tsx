import { requireWorkspace } from "@/lib/auth";
import { aiMessageLimit } from "@/lib/plans";
import { AssistantChat } from "@/components/AssistantChat";

export const metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  const { supabase, ws } = await requireWorkspace();
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [{ data: pending }, { data: usage }] = await Promise.all([
    supabase.from("ai_proposals").select("id, kind, summary").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
    supabase.from("ai_usage").select("messages").eq("month", month).maybeSingle(),
  ]);
  const limit = aiMessageLimit(ws.plan);

  return (
    <>
      <h1>AI Assistant</h1>
      <p className="muted">{usage?.messages ?? 0} of {limit} messages used this month ({ws.plan} plan).</p>
      <AssistantChat initialCards={pending ?? []} />
    </>
  );
}
