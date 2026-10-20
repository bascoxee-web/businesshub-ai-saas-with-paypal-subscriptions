import {requireWorkspace} from '@/lib/auth';
import {Banner} from '@/components/Banner';
import {billingOffers,billingMode} from '@/lib/billing';
import {aiMessageLimit} from '@/lib/plans';
import {startSubscription,subscriptionAction} from './actions';
export default async function Billing({searchParams}:{searchParams:Promise<{error?:string;notice?:string}>}){
 const {ws,supabase}=await requireWorkspace();const sp=await searchParams;const offers=billingOffers();const mode=billingMode();
 const {data:subscription}=await supabase.from('billing_subscriptions').select('status,paid_until,risk_hold,environment').eq('workspace_id',ws.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
 return <><h1>Plan &amp; billing</h1><Banner error={sp.error} notice={sp.notice}/>
 <div className="card"><h2>Current plan: {ws.plan}</h2><p>{aiMessageLimit(ws.plan)} AI messages per calendar month.</p>
 {subscription && <><p>PayPal {subscription.environment} status: <strong>{subscription.status}</strong></p>{subscription.paid_until&&<p>Verified paid period ends: {new Date(subscription.paid_until).toLocaleDateString('en-US',{timeZone:'UTC'})} (UTC).</p>}{subscription.risk_hold&&<p role="status">Payment needs review. Paid features are paused; contact support.</p>}</>}
 </div>
 <div className="card"><h2>{mode==='live'?'Monthly subscriptions':'Subscription setup & testing'}</h2>
 {!mode&&<p role="status">New purchases are unavailable while payment setup and verification are completed.</p>}
 {mode==='sandbox'&&<p><strong>Sandbox only.</strong> Use PayPal test accounts. No real charge or live plan upgrade.</p>}
 <p>Monthly automatic renewal until cancelled. Cancel future payments here or in PayPal. Access continues through your verified paid period; refunds and disputes may pause access. Plan changes require the existing paid period to finish.</p>
 <form action={startSubscription}><label htmlFor="plan">Monthly plan</label><select id="plan" name="plan" required defaultValue=""><option value="" disabled>Select a plan</option>{offers.map(p=><option key={p.plan} value={p.plan}>{p.plan} — {p.currency} {(p.cents/100).toFixed(2)} / month · {aiMessageLimit(p.plan)} AI messages</option>)}</select>
 <label className="row" style={{margin:'14px 0'}}><input type="checkbox" name="consent" value="yes" required style={{width:'auto'}}/>I agree to the selected monthly price and automatic renewal until cancellation.</label>
 <button className="btn" disabled={!mode||!offers.length} type="submit">{mode==='live'?'Subscribe with PayPal':'Continue to PayPal sandbox'}</button></form>
 {subscription&&<form action={subscriptionAction} style={{marginTop:16}}><button className="btn ghost" name="action" value="refresh">Refresh payment status</button> <button className="btn danger" name="action" value="cancel">Cancel future payments</button></form>}
 {process.env.BILLING_SUPPORT_EMAIL&&<p>Billing help: <a href={`mailto:${process.env.BILLING_SUPPORT_EMAIL}`}>{process.env.BILLING_SUPPORT_EMAIL}</a></p>}
 </div></>;
}
