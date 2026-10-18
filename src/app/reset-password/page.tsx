import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {savePassword} from './actions';
export default async function ResetPassword({searchParams}:{searchParams:Promise<{error?:string}>}){
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect('/forgot-password');
 return <main className="auth"><div className="card"><h1>Choose a new password</h1>{(await searchParams).error && <p role="alert">Use matching passwords of 8–200 characters. If the link expired, request a new recovery link.</p>}<form action={savePassword}><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={200} required/><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={200} required/><button className="btn" type="submit">Save password</button></form></div></main>;
}
