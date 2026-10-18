import {adminClient} from './supabase/admin';
import {PayPalClient} from './paypal';
import {verifiedBillingSnapshot,validateMonthlyPlan,type BillingIdentity,type BillingPlan} from './billing';

type RecordIdentity=BillingIdentity & {environment:'live'|'sandbox';plan:BillingPlan};
export async function reconcileBilling(paypal:PayPalClient, row:RecordIdentity, eventId?:string, risk=false) {
  const admin=adminClient();
  // Never lose a verified refund/reversal/dispute merely because the provider lookup fails.
  if(risk) {
    const r=await admin.from('billing_subscriptions').update({risk_hold:true}).eq('id',row.id);
    if(r.error)throw new Error('Could not place subscription under review');
  }
  const started=new Date();
  const remote=await paypal.getSubscription(row.provider_id);
  validateMonthlyPlan(await paypal.getPlan(row.provider_plan),{plan:row.plan,providerPlan:row.provider_plan,cents:row.amount_cents,currency:row.currency});
  const transactions=await paypal.subscriptionTransactions(row.provider_id);
  const verified=verifiedBillingSnapshot(remote,transactions,row);
  const saved=await admin.rpc('record_billing_snapshot',{p_id:row.id,p_provider_id:row.provider_id,p_status:verified.status,p_paid_until:verified.paidUntil,p_hold:risk||verified.hold,p_verified_at:started.toISOString(),p_payments:verified.payments,p_event_id:eventId??null});
  if(saved.error)throw new Error('Could not record verified subscription');
  return verified;
}

/** The caller must verify the webhook signature before dispatching here. */
export async function processBillingEvent(paypal:PayPalClient,event: {id:string;event_type:string;resource:any}, environment:'live'|'sandbox') {
  const admin=adminClient();
  let providerId:string|undefined;
  const type=event.event_type;
  if(type.startsWith('BILLING.SUBSCRIPTION.'))providerId=event.resource?.id;
  else if(type.startsWith('PAYMENT.SALE.'))providerId=event.resource?.billing_agreement_id;
  else if(!type.startsWith('CUSTOMER.DISPUTE.'))return false;
  const risk=['PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED','CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED'].includes(type);
  const saleIds=[event.resource?.sale_id,...(type==='PAYMENT.SALE.REVERSED'?[event.resource?.id]:[]),...(event.resource?.disputed_transactions??[]).map((t:any)=>t.seller_transaction_id)].filter((s:unknown)=>typeof s==='string').slice(0,10);
  if(risk && saleIds.length){
    const saved=await admin.from('billing_risk_transactions').upsert(saleIds.map((id:string)=>({provider_id:id,event_id:event.id})),{onConflict:'provider_id',ignoreDuplicates:true});
    if(saved.error)throw new Error('Could not retain risk notification');
  }
  const rows:RecordIdentity[]=[];
  if(providerId){
    const result=await admin.from('billing_subscriptions').select('*').eq('provider_id',providerId).eq('environment',environment).maybeSingle();
    if(result.error)throw new Error('Billing lookup failed');
    if(result.data)rows.push(result.data as RecordIdentity);
    else if(type.startsWith('BILLING.SUBSCRIPTION.')) {
      // Recover an external creation whose idempotent response was lost before local binding.
      const remote=await paypal.getSubscription(providerId);
      if(typeof remote.custom_id==='string' && /^[0-9a-f-]{36}$/i.test(remote.custom_id)) {
        const pending=await admin.from('billing_subscriptions').select('*').eq('id',remote.custom_id).eq('environment',environment).maybeSingle();
        if(pending.error)throw new Error('Pending checkout lookup failed');
        if(pending.data && !pending.data.provider_id && remote.plan_id===pending.data.provider_plan) {
          const bound=await admin.rpc('bind_billing_subscription',{p_id:pending.data.id,p_provider_id:providerId});
          if(bound.error)throw new Error('Could not recover subscription binding');
          rows.push({...pending.data,provider_id:providerId} as RecordIdentity);
        }
      }
    }
  }
  if(!rows.length && risk){
    for(const saleId of saleIds.slice(0,10)){
      const payment=await admin.from('billing_payments').select('subscription_id').eq('provider_id',saleId).maybeSingle();
      if(payment.error)throw new Error('Payment lookup failed');
      if(payment.data){
        const result=await admin.from('billing_subscriptions').select('*').eq('id',payment.data.subscription_id).eq('environment',environment).maybeSingle();
        if(result.error)throw new Error('Subscription lookup failed');
        if(result.data && !rows.some(r=>r.id===result.data.id))rows.push(result.data as RecordIdentity);
      }
    }
  }
  for(const row of rows)await reconcileBilling(paypal,row,`${event.id}:${row.id}`,risk);
  // Refund/dispute holds need owner review; a later activation or resolved event never clears them automatically.
  return type.startsWith('BILLING.SUBSCRIPTION.')||type.startsWith('PAYMENT.SALE.')||type.startsWith('CUSTOMER.DISPUTE.');
}
