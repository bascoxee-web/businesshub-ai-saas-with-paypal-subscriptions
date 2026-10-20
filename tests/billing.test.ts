import {it,expect} from 'vitest';
import {billingOffers,billingMode,billingApproval,validateMonthlyPlan,verifiedBillingSnapshot} from '../src/lib/billing';
const offer={plan:'starter' as const,providerPlan:'P-'+'A'.repeat(24),cents:1500,currency:'USD'};
const plan={id:offer.providerPlan,status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{value:'15.00',currency_code:'USD'}}}]};
const identity={id:'checkout',provider_id:'I-SUB',provider_plan:offer.providerPlan,amount_cents:1500,currency:'USD'};
const remote={id:'I-SUB',custom_id:'checkout',plan_id:offer.providerPlan,status:'ACTIVE',billing_info:{next_billing_time:'2026-11-18T00:00:00Z'}};
const payment={id:'SALE-1',status:'COMPLETED',time:'2026-10-18T00:00:00Z',amount_with_breakdown:{gross_amount:{value:'15.00',currency_code:'USD'}}};
const now=new Date('2026-10-19T00:00:00Z');
it('requires complete setup and explicit production verification to charge live',()=>{
 const env={PAYPAL_ENV:'live',SUBSCRIPTIONS_ENABLED:'live',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'webhook',SUPABASE_SERVICE_ROLE_KEY:'server',PAYPAL_PLAN_STARTER:offer.providerPlan,PAYPAL_STARTER_MONTHLY_CENTS:'1500',PAYPAL_BILLING_CURRENCY:'USD'};
 expect(billingOffers(env)).toEqual([offer]);expect(billingMode(env)).toBeNull();
 expect(billingMode({...env,VERCEL_ENV:'production',PAYPAL_LIVE_VERIFIED:'yes',CRON_SECRET:'secret',BILLING_SUPPORT_EMAIL:'support@example.com'})).toBe('live');
 expect(billingMode({...env,VERCEL_ENV:'preview',PAYPAL_LIVE_VERIFIED:'yes',CRON_SECRET:'secret',BILLING_SUPPORT_EMAIL:'support@example.com'})).toBeNull();
 expect(billingMode({...env,PAYPAL_ENV:'sandbox',SUBSCRIPTIONS_ENABLED:'sandbox'})).toBe('sandbox');
});
it('rejects trials, price differences, setup fees, taxes and nonmonthly plans',()=>{
 expect(()=>validateMonthlyPlan(plan,offer)).not.toThrow();
 for(const bad of [{...plan,billing_cycles:[...plan.billing_cycles,...plan.billing_cycles]},{...plan,payment_preferences:{setup_fee:{value:'1.00'}}},{...plan,taxes:{percentage:'5'}},{...plan,billing_cycles:[{...plan.billing_cycles[0],frequency:{interval_unit:'YEAR',interval_count:1}}]}])expect(()=>validateMonthlyPlan(bad,offer)).toThrow();
 expect(()=>validateMonthlyPlan(plan,{...offer,cents:100})).toThrow();
});
it('does not grant access merely because PayPal says ACTIVE',()=>{
 expect(verifiedBillingSnapshot(remote,{transactions:[]},identity,now).paidUntil).toBeNull();
 expect(verifiedBillingSnapshot(remote,{transactions:[payment]},identity,now).paidUntil).toBe('2026-11-18T00:00:00.000Z');
 expect(verifiedBillingSnapshot(remote,{transactions:[{...payment,status:'PENDING'}]},identity,now).paidUntil).toBeNull();
});
it('rejects mismatched subscription, checkout, price, currency and future transactions',()=>{
 for(const change of [{id:'I-OTHER'},{custom_id:'other'},{plan_id:'P-OTHER'},{quantity:'2'},{plan_overridden:true}])expect(()=>verifiedBillingSnapshot({...remote,...change},{transactions:[payment]},identity,now)).toThrow();
 for(const change of [{time:'2030-01-01T00:00:00Z'},{amount_with_breakdown:{gross_amount:{value:'1.00',currency_code:'USD'}}},{amount_with_breakdown:{gross_amount:{value:'15.00',currency_code:'PHP'}}}])expect(()=>verifiedBillingSnapshot(remote,{transactions:[{...payment,...change}]},identity,now)).toThrow();
});
it('caps payment access to one month and clamps month-end dates',()=>{
 const r={...remote,billing_info:{next_billing_time:'2030-01-01T00:00:00Z'}};
 expect(verifiedBillingSnapshot(r,{transactions:[payment]},identity,now).paidUntil).toBe('2026-11-18T00:00:00.000Z');
 expect(verifiedBillingSnapshot(r,{transactions:[{...payment,time:'2026-01-31T00:00:00Z'}]},identity,now).paidUntil).toBe('2026-02-28T00:00:00.000Z');
});
it('holds refunded and reversed subscriptions for review',()=>{
 for(const status of ['REFUNDED','PARTIALLY_REFUNDED','REVERSED'])expect(verifiedBillingSnapshot(remote,{transactions:[{...payment,status}]},identity,now).hold).toBe(true);
});
it('uses the correct environment approval host',()=>{
 const data=(href:string)=>({links:[{rel:'approve',href}]});
 expect(billingApproval(data('https://www.paypal.com/approve'),'live')).toContain('www.paypal.com');
 for(const url of ['http://www.paypal.com/','https://www.paypal.com.evil.test/','https://www.sandbox.paypal.com/'])expect(()=>billingApproval(data(url),'live')).toThrow();
});
