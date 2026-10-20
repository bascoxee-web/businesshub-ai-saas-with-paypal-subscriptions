import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceOrNull } from "@/lib/auth";
import { uuid } from "@/lib/schemas";
import { payloadSchemas } from "@/lib/ai/proposals";

const bodySchema = z.object({ action: z.enum(["confirm", "dismiss"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getWorkspaceOrNull();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { supabase, user, ws } = session;

  const { id } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (body.data.action === "dismiss") {
    const {data,error}=await supabase.from("ai_proposals").update({status:"dismissed"}).eq("id",id).eq("workspace_id",ws.id).eq("user_id",user.id).eq("status","pending").select("id").maybeSingle();
    if(error) return NextResponse.json({error:"Could not dismiss the suggestion."},{status:500});
    return NextResponse.json(data?{status:"dismissed"}:{error:"Suggestion already handled."},{status:data?200:409});
  }
  const {data:proposal}=await supabase.from("ai_proposals").select("kind,payload").eq("id",id).eq("workspace_id",ws.id).eq("user_id",user.id).maybeSingle();
  if(!proposal) return NextResponse.json({error:"Suggestion unavailable."},{status:404});
  const schema=payloadSchemas[proposal.kind as keyof typeof payloadSchemas];
  if(!schema?.safeParse(proposal.payload).success) return NextResponse.json({error:"The suggestion is invalid."},{status:422});
  const {data:href,error}=await supabase.rpc("confirm_ai_proposal",{proposal_uuid:id});
  if(error) return NextResponse.json({error:"Could not confirm the suggestion. Nothing was partially saved; you can retry."},{status:422});
  return NextResponse.json({status:"confirmed",href});
}
