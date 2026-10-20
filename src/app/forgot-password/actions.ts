'use server';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {siteUrl} from '@/lib/site';
import {recoveryEmail} from '@/lib/password-input';
import {failTo} from '@/lib/auth';
export async function requestRecovery(form:FormData){
 const email=recoveryEmail.safeParse(form.get('email'));
 if(!email.success) failTo('/forgot-password','Enter a valid email address.');
 const supabase=await createClient();
 await supabase.auth.resetPasswordForEmail(email.data,{redirectTo:`${await siteUrl()}/auth/callback?next=/reset-password`});
 // Identical response for known and unknown accounts.
 redirect('/forgot-password?notice=sent');
}
