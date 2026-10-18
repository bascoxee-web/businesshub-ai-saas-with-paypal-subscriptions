'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireWorkspace, failTo } from '@/lib/auth';
import { uuid } from '@/lib/schemas';
import { buildEvidence } from '@/lib/seo/evidence';
import { liveAuditInput, scrapeEvidence } from '@/lib/seo/live';
import { snapshotSchema, snapshotText } from '@/lib/seo/input';
export async function createSnapshotReport(form: FormData) {
 const { supabase, ws } = await requireWorkspace();
 const parsed = snapshotSchema.safeParse(Object.fromEntries(form));
 if (!parsed.success) failTo('/app/seo', parsed.error.issues[0]?.message ?? 'Check the snapshot.');
 const { name, url, html } = parsed.data;
 const report = buildEvidence(html, snapshotText(html), { name, url });
 const { data, error } = await supabase.from('seo_reports').insert({ workspace_id: ws.id, name, url, report }).select('id').single();
 if (error || !data) failTo('/app/seo', 'Could not save the report. The SEO database setup may still be pending.');
 revalidatePath('/app/seo'); redirect(`/app/seo/${data.id}`);
}
export async function findingToTask(id: string, form: FormData) {
 const { supabase } = await requireWorkspace();
 if (!uuid.safeParse(id).success) redirect('/app/seo');
 const project = uuid.safeParse(form.get('project_id')); const finding = form.get('finding_id');
 if (!project.success || typeof finding !== 'string' || finding.length > 100) failTo(`/app/seo/${id}`, 'Select a project and a valid finding.');
 const { error } = await supabase.rpc('seo_finding_to_task', { report_uuid: id, finding_key: finding, project_uuid: project.data });
 if (error) failTo(`/app/seo/${id}`, 'Could not create the task. Confirm that the report and project belong to this workspace.');
 revalidatePath(`/app/seo/${id}`); revalidatePath(`/app/projects/${project.data}`); redirect(`/app/seo/${id}`);
}

export async function createLiveReport(form:FormData){
 const {supabase,ws}=await requireWorkspace();
 const input=liveAuditInput.safeParse(Object.fromEntries(form));
 if(!input.success) failTo('/app/seo','Enter a business name and public website URL.');
 if(!process.env.FIRECRAWL_API_KEY) failTo('/app/seo','Live website auditing has not been configured yet.');
 const {data:allowed,error:limitError}=await supabase.rpc('reserve_live_audit',{p_workspace:ws.id});
 if(limitError) failTo('/app/seo','Could not check the audit allowance. Database setup may be pending.');
 if(!allowed) failTo('/app/seo','Your monthly live audit allowance has been used.');
 let id:string;
 try {
  const report=await scrapeEvidence(input.data,process.env.FIRECRAWL_API_KEY);
  const {data,error}=await supabase.from('seo_reports').insert({workspace_id:ws.id,name:input.data.name,url:report.url,report}).select('id').single();
  if(error || !data)throw new Error('The audit completed but could not be saved.');
  id=data.id;
 }catch{failTo('/app/seo','The audit could not be completed or saved. This attempt counts toward your monthly allowance.');}
 revalidatePath('/app/seo');redirect(`/app/seo/${id}`);
}
