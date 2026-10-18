import Link from 'next/link';
import { requireWorkspace } from '@/lib/auth';
import { Banner } from '@/components/Banner';
import { createSnapshotReport, createLiveReport } from './actions';
export const metadata = { title: 'SEO Grader' };
export default async function SEOPage({ searchParams }: { searchParams: Promise<{error?: string}> }) {
 const { supabase, ws } = await requireWorkspace(); const sp = await searchParams;
 const { data, error } = await supabase.from('seo_reports').select('id,name,url,created_at').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(100);
 return <><h1>SEO Grader</h1><p>Review website evidence and turn findings into project tasks.</p><Banner error={sp.error}/>
 {error && <p className="banner" role="status">SEO report storage has not been configured. Reports cannot be saved yet.</p>}
 <div className="card"><h2>Audit a live website</h2><p>Check one public page for website signals. Each attempt uses your monthly audit allowance, including failed attempts. Pilot allowances: Free 3, Starter 20, Growth 100, Business 300.</p><form action={createLiveReport}><div className="field"><label htmlFor="live-name">Business name</label><input id="live-name" name="name" required maxLength={120}/></div><div className="field"><label htmlFor="live-url">Page URL</label><input id="live-url" name="url" type="url" required maxLength={2048}/></div><button className="btn" type="submit" disabled={!!error || !process.env.FIRECRAWL_API_KEY}>Audit website</button></form>{!process.env.FIRECRAWL_API_KEY && <p className="muted">Live auditing setup is pending.</p>}</div>
 <div className="card"><h2>Check an HTML snapshot</h2><p className="muted">Paste page source you have obtained. This checks supplied HTML only; it does not visit the website or measure Google rankings. JavaScript-rendered content may be absent.</p>
 <form action={createSnapshotReport}>
 <div className="field"><label htmlFor="name">Business name</label><input id="name" name="name" required maxLength={120}/></div>
 <div className="field"><label htmlFor="url">Page URL</label><input id="url" name="url" type="url" required maxLength={2048}/></div>
 <div className="field"><label htmlFor="html">Page HTML</label><textarea id="html" name="html" required minLength={20} maxLength={250000} rows={8} spellCheck={false}/></div>
 <button className="btn" type="submit" disabled={!!error}>Check and save snapshot</button></form></div>
 <div className="card"><h2>Saved reports</h2>{!data?.length ? <p className="muted">No saved reports.</p> : <ul>{data.map(r => <li key={r.id}><Link href={`/app/seo/${r.id}`}>{r.name}</Link> <span className="muted">— {r.url} · {new Date(r.created_at).toLocaleDateString('en-US')}</span></li>)}</ul>}</div></>;
}
