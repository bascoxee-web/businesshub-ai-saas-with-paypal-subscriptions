import {z} from 'zod';
export const paidPlan=z.enum(['starter','growth','business']);
export function subscriptionPlans(env:Record<string,string|undefined>=process.env){
 return Object.fromEntries(paidPlan.options.flatMap(plan=>{
  const id=env[`PAYPAL_PLAN_${plan.toUpperCase()}`];
  return id && /^P-[A-Z0-9]{24}$/.test(id)?[[plan,id]]:[];
 })) as Partial<Record<z.infer<typeof paidPlan>,string>>;
}
export function subscriptionsEnabled(env:Record<string,string|undefined>=process.env){
 return env.SUBSCRIPTIONS_ENABLED==='sandbox' && env.PAYPAL_ENV==='sandbox' && !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET && !!env.SUPABASE_SERVICE_ROLE_KEY;
}
export function approvalUrl(data:unknown):string {
 const result=z.object({links:z.array(z.object({rel:z.string(),href:z.string()}))}).parse(data);
 const href=result.links.find(l=>l.rel==='approve')?.href;if(!href)throw new Error('Approval link unavailable.');
 const u=new URL(href);if(u.protocol!=='https:' || u.hostname!=='www.sandbox.paypal.com' || u.username || u.password)throw new Error('Invalid sandbox approval link.');
 return u.href;
}
// Sandbox entitlement preview only. This never writes workspaces.plan or grants paid production access.
export function subscriptionPreview(remote:unknown,expected:{id:string;checkout:string;planId:string}){
 const s=z.object({id:z.string(),custom_id:z.string(),plan_id:z.string(),status:z.enum(['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED']),billing_info:z.object({next_billing_time:z.string().optional()}).optional()}).parse(remote);
 if(s.id!==expected.id || s.custom_id!==expected.checkout || s.plan_id!==expected.planId)throw new Error('Subscription identity mismatch.');
 return {status:s.status,nextBilling:s.billing_info?.next_billing_time??null};
}
