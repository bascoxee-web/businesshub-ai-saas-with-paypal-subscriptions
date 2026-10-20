import { z } from 'zod';
import { decimalToCents } from './paypal';

export const billingPlan = z.enum(['starter', 'growth', 'business']);
export type BillingPlan = z.infer<typeof billingPlan>;
export type Offer = { plan: BillingPlan; providerPlan: string; cents: number; currency: string };
export function billingOffers(env: Record<string, string | undefined> = process.env): Offer[] {
  return billingPlan.options.flatMap(plan => {
    const prefix = `PAYPAL_${plan.toUpperCase()}`;
    const providerPlan = env[`PAYPAL_PLAN_${plan.toUpperCase()}`] ?? '';
    const amount = env[`${prefix}_MONTHLY_CENTS`] ?? '';
    const currency = env.PAYPAL_BILLING_CURRENCY ?? '';
    if (!/^P-[A-Z0-9]{24}$/.test(providerPlan) || !/^[1-9]\d{0,7}$/.test(amount) || !['USD', 'PHP'].includes(currency)) return [];
    return [{ plan, providerPlan, cents: Number(amount), currency }];
  });
}
export function billingMode(env: Record<string, string | undefined> = process.env): 'live' | 'sandbox' | null {
  const mode = env.PAYPAL_ENV;
  if (!['live','sandbox'].includes(mode ?? '') || env.SUBSCRIPTIONS_ENABLED !== mode) return null;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID || !env.SUPABASE_SERVICE_ROLE_KEY || !billingOffers(env).length) return null;
  // A separate production release gate prevents accidental charges from a preview deployment.
  if (mode === 'live' && (env.VERCEL_ENV !== 'production' || env.PAYPAL_LIVE_VERIFIED !== 'yes' || !env.CRON_SECRET || !env.BILLING_SUPPORT_EMAIL)) return null;
  return mode as 'live' | 'sandbox';
}
export function validateMonthlyPlan(raw: unknown, offer: Offer) {
  const p = z.object({id:z.string(),status:z.literal('ACTIVE'),billing_cycles:z.array(z.object({tenure_type:z.string(),total_cycles:z.number(),frequency:z.object({interval_unit:z.string(),interval_count:z.number()}),pricing_scheme:z.object({fixed_price:z.object({value:z.string(),currency_code:z.string()})})})),payment_preferences:z.object({setup_fee:z.object({value:z.string()}).optional()}).optional(),taxes:z.object({percentage:z.string()}).optional()}).parse(raw);
  const cycle = p.billing_cycles[0];
  if(p.id !== offer.providerPlan || p.billing_cycles.length !== 1 || cycle.tenure_type !== 'REGULAR' || cycle.total_cycles !== 0 || cycle.frequency.interval_unit !== 'MONTH' || cycle.frequency.interval_count !== 1 || decimalToCents(cycle.pricing_scheme.fixed_price.value) !== offer.cents || cycle.pricing_scheme.fixed_price.currency_code !== offer.currency || Number(p.payment_preferences?.setup_fee?.value ?? 0) !== 0 || Number(p.taxes?.percentage ?? 0) !== 0) throw new Error('PayPal plan terms differ from the published monthly offer.');
}
export function billingApproval(raw:unknown, mode:'live'|'sandbox') {
  const r=z.object({links:z.array(z.object({rel:z.string(),href:z.string()}))}).parse(raw);
  const u=new URL(r.links.find(l=>l.rel==='approve')?.href ?? 'invalid');
  if(u.protocol!=='https:' || u.hostname !== (mode==='live'?'www.paypal.com':'www.sandbox.paypal.com') || u.username || u.password || u.port) throw new Error('Invalid PayPal approval link');
  return u.href;
}
export type BillingIdentity = {id:string;provider_id:string;provider_plan:string;amount_cents:number;currency:string};
export function verifiedBillingSnapshot(raw:unknown, transactions:unknown, expected:BillingIdentity, now=new Date()) {
  const s=z.object({id:z.string(),custom_id:z.string(),plan_id:z.string(),status:z.enum(['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED']),quantity:z.string().optional(),plan_overridden:z.boolean().optional(),billing_info:z.object({next_billing_time:z.string().optional()}).optional()}).parse(raw);
  if(s.id!==expected.provider_id || s.custom_id!==expected.id || s.plan_id!==expected.provider_plan || (s.quantity && s.quantity!=='1') || s.plan_overridden) throw new Error('Subscription identity or terms mismatch');
  const list=z.object({transactions:z.array(z.object({id:z.string().min(1).max(128),status:z.string(),time:z.string(),amount_with_breakdown:z.object({gross_amount:z.object({value:z.string(),currency_code:z.string()})})})).max(100)}).parse(transactions);
  let paidUntil:string|null=null; let hold=false;
  const payments=list.transactions.map(t=>{
    const at=new Date(t.time); const cents=decimalToCents(t.amount_with_breakdown.gross_amount.value);
    if(!Number.isFinite(at.valueOf()) || at.valueOf()>now.valueOf()+300000 || cents!==expected.amount_cents || t.amount_with_breakdown.gross_amount.currency_code!==expected.currency) throw new Error('Payment terms mismatch');
    if(['REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(t.status))hold=true;
    if(t.status==='COMPLETED') {
      // A monthly payment grants at most one calendar month, even if next_billing_time is wrong.
      const end=new Date(at);const day=end.getUTCDate();end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1);const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();end.setUTCDate(Math.min(day,last));
      const next=new Date(s.billing_info?.next_billing_time ?? 'invalid');
      const until=Number.isFinite(next.valueOf()) && next>at && next<end ? next : end;
      if(!paidUntil || until.valueOf()>Date.parse(paidUntil)) paidUntil=until.toISOString();
    }
    return {id:t.id,status:t.status,paid_at:at.toISOString(),amount_cents:cents,currency:expected.currency};
  });
  return {status:s.status,paidUntil,hold,payments};
}
