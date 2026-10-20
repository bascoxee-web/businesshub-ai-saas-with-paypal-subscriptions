'use server';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {requireWorkspace,failTo} from '@/lib/auth';
import {adminClient} from '@/lib/supabase/admin';
import {generateTool,toolDefinition,parseToolRecord} from '@/lib/builder';

export async function buildTool(form:FormData){
 const {supabase,ws}=await requireWorkspace();
 const request=z.string().trim().min(15).max(1500).safeParse(form.get('request'));
 if(!request.success)failTo('/app/tools','Describe the form or tracker in 15–1,500 characters.');
 if(form.get('consent')!=='yes')failTo('/app/tools','Confirm use of one generation attempt.');
 if(!process.env.GEMINI_API_KEY||!process.env.GEMINI_MODEL||!process.env.SUPABASE_SERVICE_ROLE_KEY)failTo('/app/tools','AI Builder is not configured. No attempt was used.');
 const {data:reserved,error}=await supabase.rpc('reserve_builder_request',{p_workspace:ws.id});
 if(error||reserved!==true)failTo('/app/tools','An active main plan, AI Builder add-on, owner role and remaining generation allowance are required.');
 let id:string;
 try{
  const definition=await generateTool(request.data);
  const result=await adminClient().from('custom_tools').insert({workspace_id:ws.id,definition,published:false}).select('id').single();
  if(result.error||!result.data)throw new Error('Save failed');id=result.data.id;
 }catch{failTo('/app/tools','Generation failed. This attempt counted toward the monthly allowance. No tool was published.');}
 redirect('/app/tools/'+id);
}
export async function publishTool(form:FormData){
 const {supabase}=await requireWorkspace();const id=z.uuid().safeParse(form.get('tool_id'));if(!id.success)failTo('/app/tools','Invalid tool.');
 const {error}=await supabase.rpc('publish_custom_tool',{p_tool:id.data});if(error)failTo('/app/tools/'+id.data,'Publishing needs an active main plan, AI Builder add-on and workspace owner access.');
 redirect('/app/tools/'+id.data+'?notice=Tool%20published');
}
export async function addRecord(form:FormData){
 const {supabase,ws}=await requireWorkspace();const id=z.uuid().safeParse(form.get('tool_id'));if(!id.success)failTo('/app/tools','Invalid tool.');
 const path='/app/tools/'+id.data;const {data:tool}=await supabase.from('custom_tools').select('definition').eq('id',id.data).eq('workspace_id',ws.id).single();
 if(!tool)failTo('/app/tools','Tool unavailable.');
 let payload;try{payload=parseToolRecord(toolDefinition.parse(tool.definition),form);}catch{failTo(path,'Check the required fields, dates, numbers and options.');}
 const {error}=await supabase.rpc('add_custom_tool_record',{p_tool:id.data,p_payload:payload});
 if(error)failTo(path,'Record could not be saved. Check that both subscriptions are active and this published tool has fewer than 1,000 records.');
 redirect(path+'?notice=Record%20saved');
}
