'use server';
import {redirect} from 'next/navigation';
import {requireWorkspace,failTo} from '@/lib/auth';
import {adminClient} from '@/lib/supabase/admin';
import {livePayPal} from '@/lib/paypal-live';
import {siteUrl} from '@/lib/site';
import {billingPlan,billingOffers,billingMode,billingApproval,validateMonthlyPlan} from '@/lib/billing';
import {reconcileBilling} from '@/lib/billing-live';
import {hubPlans,builderOffer} from '@/lib/catalog';
import {z} from 'zod';

export async function startSubscription(form:FormData){
 const {supabase,ws}=await requireWorkspace();
 const mode=billingMode();if(!mode)failTo('/app/billing','Payment setup and verification are still pending.');
 const plan=billingPlan.safeParse(form.get('plan'));if(!plan.success)failTo('/app/billing','Select a valid plan.');
 const offer=billingOffers().find(p=>p.plan===plan.data);if(!offer)failTo('/app/billing','This plan is unavailable.');
 const product=hubPlans.find(p=>p.id===offer.plan) ?? (offer.plan==='ai_builder'?builderOffer:null);
 if(!product||offer.currency!=='USD'||offer.cents!==product.cents)failTo('/app/billing','This offer is not configured at its published price.');
 if(form.get('consent')!=='yes')failTo('/app/billing','Confirm the recurring monthly terms before continuing.');
 let url:string;
 try{
  const paypal=livePayPal()!; const admin=adminClient();
  validateMonthlyPlan(await paypal.getPlan(offer.providerPlan),offer);
  const {data:checkout,error}=await supabase.rpc('prepare_billing_checkout',{p_workspace:ws.id,p_plan:offer.plan,p_environment:mode});
  if(error||!checkout)throw new Error('Could not reserve checkout');
  const terms=await admin.rpc('configure_billing_checkout',{p_id:checkout.id,p_environment:mode,p_provider_plan:offer.providerPlan,p_amount:offer.cents,p_currency:offer.currency});
  if(terms.error)throw new Error('Checkout configuration mismatch');
  const remote=checkout.provider_id?await paypal.getSubscription(checkout.provider_id):await paypal.createSubscription(offer.providerPlan,checkout.id,await siteUrl());
  if(remote.custom_id!==checkout.id || remote.plan_id!==offer.providerPlan || !remote.id)throw new Error('Checkout identity mismatch');
  const bound=await admin.rpc('bind_billing_subscription',{p_id:checkout.id,p_provider_id:remote.id});
  if(bound.error)throw new Error('Could not bind checkout');
  url=billingApproval(remote,mode);
 }catch{failTo('/app/billing','Could not start or resume checkout. If you have already approved, use Refresh payment status. Contact support before creating another subscription.');}
 redirect(url);
}
export async function subscriptionAction(form:FormData){
 const {supabase,user,ws}=await requireWorkspace();
 const action=form.get('action');if(!['refresh','cancel'].includes(String(action)))failTo('/app/billing','Invalid action.');
 // Keep management available if new sales have been disabled, provided credentials still exist.
 const mode=process.env.PAYPAL_ENV;if(!['live','sandbox'].includes(mode??''))failTo('/app/billing','Payment management is unavailable.');
 const {data:member}=await supabase.from('workspace_members').select('role').eq('workspace_id',ws.id).eq('user_id',user.id).maybeSingle();
 if(member?.role!=='owner')failTo('/app/billing','Only the workspace owner can manage subscriptions.');
 const id=z.uuid().safeParse(form.get('subscription_id'));
 if(!id.success)failTo('/app/billing','Choose the subscription to manage.');
 const {data:row}=await supabase.from('billing_subscriptions').select('*').eq('id',id.data).eq('workspace_id',ws.id).eq('environment',mode).maybeSingle();
 if(!row?.provider_id)failTo('/app/billing','No subscription has been linked yet.');
 let notice:string;
 try{
  const paypal=livePayPal();if(!paypal)throw new Error('Credentials unavailable');
  const verified=await reconcileBilling(paypal,row);
  if(action==='cancel'){
   if(!['CANCELLED','EXPIRED'].includes(verified.status))await paypal.cancelSubscription(row.provider_id);
   await reconcileBilling(paypal,row);
   notice='Cancellation requested. PayPal status is shown below. Verified access remains until the paid period ends, unless a refund or dispute needs review.';
  }else notice='Payment status checked with PayPal. Sandbox payments never unlock a live plan.';
 }catch{failTo('/app/billing','Could not confirm payment status. Please retry or manage your automatic payment directly in PayPal.');}
 redirect(`/app/billing?notice=${encodeURIComponent(notice)}`);
}
