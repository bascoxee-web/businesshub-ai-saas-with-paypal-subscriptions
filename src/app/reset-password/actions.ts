'use server';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {newPassword} from '@/lib/password-input';
import {failTo} from '@/lib/auth';
export async function savePassword(form:FormData){
 const input=newPassword.safeParse(Object.fromEntries(form));
 if(!input.success) failTo('/reset-password','Use matching passwords of 8 to 200 characters.');
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user) redirect('/forgot-password');
 const {error}=await supabase.auth.updateUser({password:input.data.password});
 if(error) failTo('/reset-password','Could not update your password. Request a fresh recovery link and try again.');
 await supabase.auth.signOut(); redirect('/login?notice=password-updated');
}
