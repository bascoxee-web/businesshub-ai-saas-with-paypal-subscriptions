import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth';
import { uuid } from '@/lib/schemas';
import { Banner } from '@/components/Banner';
import type { EvidenceReport } from '@/lib/seo/evidence';
import { findingToTask } from '../actions';
export default async function ReportPage({ params, searchParams }: {params: Promise<{id: string}>; searchParams: Promise<{error?: string}>}) {
 const { id } = await params; if (!uuid.safeParse(id).success) notFound();
 const { supabase, ws } = await requireWorkspace();
 const [result, projects, links] = await Promise.all([
 supabase.from('seo_reports').select('id,name,url,report,created_at').eq('id', id).eq('workspace_id', ws.id).maybeSingle(),
 supabase.from('projects').select('id,name').eq('workspace_id', ws.id).order('name').limit(500),
 supabase.from('seo_finding_tasks').select('finding_id,task_id').eq('report_id', id).eq('workspace_id', ws.id)]);
 if (result.error) return <><h1>SEO report unavailable</h1><p role="alert">Report storage could not be reached. Please retry.</p><Link href="/app/seo">Back to SEO Grader</Link></>;
 if (!result.data) notFound(); const row = result.data; const report = row.report as EvidenceReport;
 const linked = new Set((links.data ?? []).map(l => l.finding_id));
 return <><Link href="/app/seo">← SEO Grader</Link><h1>{row.name}</h1><Banner error={(await searchParams).error}/><p>{row.url}</p>
 <div className="card"><h2>Website signal score: {report.score}/100</h2><p>{report.disclaimer}</p><p className="muted">{report.source}. Saved {new Date(row.created_at).toLocaleString('en-US')}.</p></div>
 {links.error && <p role="alert">Task links could not be loaded. Retry before converting findings.</p>}
 {!projects.data?.length && <p><Link href="/app/projects">Create a project</Link> to track findings as tasks.</p>}
 {report.findings.map(f => <article className="card" key={f.id}><h2>{f.title}</h2><p className="muted">{f.category} · {f.status} · {f.confidence} confidence</p><p><strong>Evidence:</strong> {f.evidence}</p><p><strong>Next action:</strong> {f.recommendation}</p>
 {linked.has(f.id) ? <p className="pill ok">Task created</p> : <form action={findingToTask.bind(null, id)}><input type="hidden" name="finding_id" value={f.id}/><label htmlFor={`project-${f.id}`}>Project for this finding</label><select id={`project-${f.id}`} name="project_id" required defaultValue=""><option value="" disabled>Select project</option>{projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn small" type="submit" disabled={!projects.data?.length || !!links.error}>Create task</button></form>}</article>)}</>;
}
