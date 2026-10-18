import { NextResponse } from "next/server";
import { geminiClient } from "@/lib/ai/gemini";
import { z } from "zod";
import { getWorkspaceOrNull } from "@/lib/auth";
import { aiMessageLimit } from "@/lib/plans";
import { todayISO } from "@/lib/invoice-status";
import { runAssistant } from "@/lib/ai/run";
import { supabaseRepo } from "@/lib/ai/repo";
import { systemPrompt } from "@/lib/ai/tools";

export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1].role === "user", "The last message must be from the user"),
});

export async function POST(request: Request) {
  const session = await getWorkspaceOrNull();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { supabase, user, ws } = session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That message couldn't be read." }, { status: 400 });

  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) {
    return NextResponse.json({ error: "The assistant isn't set up yet. Add GEMINI_API_KEY and GEMINI_MODEL to the server settings." }, { status: 503 });
  }

  // Count the message against the plan before spending anything on the model.
  const limit = aiMessageLimit(ws.plan);
  const { data: allowed, error: usageError } = await supabase.rpc("consume_ai_message", { p_workspace: ws.id, p_limit: limit });
  if (usageError) return NextResponse.json({ error: "Could not check your plan limit. Please try again." }, { status: 500 });
  if (!allowed) {
    return NextResponse.json({ error: `You've used all ${limit} assistant messages for this month on the ${ws.plan} plan.` }, { status: 429 });
  }

  try {
    const llm = geminiClient(process.env.GEMINI_API_KEY);
    const result = await runAssistant({
      llm,
      repo: supabaseRepo(supabase, ws, user.id),
      currency: ws.currency,
      model: process.env.GEMINI_MODEL,
      system: systemPrompt({ workspaceName: ws.name, currency: ws.currency, today: todayISO() }),
      messages: parsed.data.messages,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("assistant failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The assistant ran into a problem. Please try again." }, { status: 502 });
  }
}
