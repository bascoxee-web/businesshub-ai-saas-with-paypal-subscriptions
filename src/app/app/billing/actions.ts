'use server';
import {redirect} from 'next/navigation';
import {requireWorkspace,failTo} from '@/lib/auth';
import {adminClient} from '@/lib/supabase/admin';
import {livePayPal} from '@/lib/paypal-live';
import {siteUrl} from '@/lib/site';
import {paidPlan,subscriptionPlans,subscriptionsEnabled,approvalUrl,subscriptionPreview} from '@/lib/subscriptions';
export async function startSubscription(form:FormData){
 const {supabase,ws}=await requireWorkspace();
 if(!subscriptionsEnabled())failTo('/app/billing','Sandbox subscription setup is pending.');
 const plan=paidPlan.safeParse(form.get('plan'));if(!plan.success)failTo('/app/billing','Select a valid plan.');
 const planId=subscriptionPlans()[plan.data];if(!planId)failTo('/app/billing','This sandbox plan has not been configured.');
 const {data:c,error}=await supabase.rpc('reserve_subscription_checkout',{p_workspace:ws.id,p_plan:plan.data});
 if(error || !c)failTo('/app/billing','Could not reserve checkout. An existing plan may need reconciliation.');
 let url:string;
 try{
  const paypal=livePayPal()!;
  const remote=c.provider_id?await paypal.getSubscription(c.provider_id):await paypal.createSubscription(planId,c.id,await siteUrl());
  subscriptionPreview(remote,{id:remote.id,checkout:c.id,planId});
  const bound=await adminClient().rpc('bind_subscription_checkout',{checkout_uuid:c.id,subscription_id:remote.id});
  if(bound.error)throw new Error('Could not bind checkout');
  url=approvalUrl(remote);
 }catch{failTo('/app/billing','Could not start or resume sandbox checkout. Use Refresh status if already approved.');}
 redirect(url);
}
export async function subscriptionAction(form:FormData){
 const {supabase,user,ws}=await requireWorkspace();
 if(!subscriptionsEnabled())failTo('/app/billing','Sandbox subscriptions are disabled.');
 const {data:member}=await supabase.from('workspace_members').select('role').eq('workspace_id',ws.id).eq('user_id',user.id).maybeSingle();
 if(member?.role!=='owner')failTo('/app/billing','Only the workspace owner can manage subscriptions.');
 const {data:c}=await supabase.from('subscription_checkouts').select('id,plan,provider_id').eq('workspace_id',ws.id).maybeSingle();
 if(!c?.provider_id)failTo('/app/billing','No bound sandbox subscription exists.');
 const planId=subscriptionPlans()[c.plan as 'starter'|'growth'|'business'];if(!planId)failTo('/app/billing','Sandbox plan configuration is unavailable.');
 let status:string;
 try{
  const paypal=livePayPal()!;
  const remote=await paypal.getSubscription(c.provider_id);
  const preview=subscriptionPreview(remote,{id:c.provider_id,checkout:c.id,planId});
  if(form.get('action')==='cancel'){
   if(!['CANCELLED','EXPIRED'].includes(preview.status))await paypal.cancelSubscription(c.provider_id);
   status='Cancellation requested. Refresh to confirm PayPal status.';
  }else status=`Verified PayPal sandbox status: ${preview.status}. Sandbox does not change your production plan.`;
 }catch{failTo('/app/billing','Could not verify or update the sandbox subscription. Please retry.');}
 redirect(`/app/billing?notice=${encodeURIComponent(status)}`);
}
