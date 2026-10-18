import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Banner } from '@/components/Banner';
import { initializeWorkspace } from './actions';
export default async function Onboarding({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect('/login');
 const {data}=await supabase.from('workspaces').select('id').limit(1).maybeSingle();
 if(data) redirect('/app');
 return <main className="auth"><div className="card"><h1>Set up BusinessHub</h1><p>Create your private workspace to start managing work and SEO reports.</p><Banner error={(await searchParams).error}/><form action={initializeWorkspace}><label htmlFor="workspace_name">Workspace name</label><input id="workspace_name" name="workspace_name" required maxLength={80} defaultValue="My workspace"/><button className="btn" type="submit">Create workspace</button></form></div></main>;
}
