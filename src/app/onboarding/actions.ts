'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { failTo } from '@/lib/auth';
export async function initializeWorkspace(form:FormData) {
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect('/login');
 const name=String(form.get('workspace_name')??'').trim();
 if(!name || name.length>80) failTo('/onboarding','Enter a workspace name between 1 and 80 characters.');
 const {error}=await supabase.rpc('initialize_workspace',{workspace_name:name});
 if(error) failTo('/onboarding','Workspace setup is unavailable. Database configuration may still be pending.');
 redirect('/app');
}
