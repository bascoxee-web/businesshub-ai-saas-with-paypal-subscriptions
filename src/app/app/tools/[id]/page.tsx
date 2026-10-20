import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireWorkspace} from '@/lib/auth';
import {toolDefinition} from '@/lib/builder';
import {Banner} from '@/components/Banner';
import {ToolFields} from '@/components/ToolForm';
import {publishTool,addRecord} from '../actions';
import {z} from 'zod';
export default async function Tool({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;notice?:string}>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const {supabase,ws}=await requireWorkspace();const sp=await searchParams;
 const [tool,access,records]=await Promise.all([supabase.from('custom_tools').select('definition,published').eq('id',id).eq('workspace_id',ws.id).maybeSingle(),supabase.rpc('has_builder',{p_workspace:ws.id}),supabase.from('custom_tool_records').select('id,payload,created_at').eq('tool_id',id).eq('workspace_id',ws.id).order('created_at',{ascending:false}).limit(1000)]);
 if(tool.error)throw new Error('Could not load tool');if(!tool.data)notFound();const parsed=toolDefinition.safeParse(tool.data.definition);if(!parsed.success)throw new Error('Tool definition unavailable');const definition=parsed.data;const active=access.data===true;
 return <><Link href="/app/tools">← My custom tools</Link><h1>{definition.name}</h1><p>{definition.description}</p><Banner error={sp.error} notice={sp.notice}/>{!active&&<p role="status">Read-only: activate your main plan and AI Builder add-on to publish tools or add records.</p>}<div className="card"><h2>{tool.data.published?'Add a record':'Preview your draft form'}</h2>{tool.data.published?<form action={addRecord}><input type="hidden" name="tool_id" value={id}/><ToolFields definition={definition} disabled={!active}/><button className="btn" disabled={!active}>Save record</button></form>:<><ToolFields definition={definition} disabled/><p>Review field names and options before publishing. This tracker does not perform any external actions.</p><form action={publishTool}><input type="hidden" name="tool_id" value={id}/><button className="btn" disabled={!active}>Publish this tool</button></form></>}</div><div className="card"><h2>Saved records</h2>{records.error?<p role="alert">Records could not be loaded. Please retry.</p>:!records.data?.length?<p className="muted">No records yet.</p>:<div className="table-scroll"><table><thead><tr>{definition.fields.map(f=><th key={f.id}>{f.label}</th>)}</tr></thead><tbody>{records.data.map(r=><tr key={r.id}>{definition.fields.map(f=><td key={f.id}>{typeof r.payload?.[f.id]==='boolean'?(r.payload[f.id]?'Yes':'No'):String(r.payload?.[f.id]??'—')}</td>)}</tr>)}</tbody></table></div>}</div></>;
}
