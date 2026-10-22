import Link from 'next/link';
import {Brand} from '@/components/Brand';
import {paidPlansEnabled} from '@/lib/release';
import {hubPlans,coreFeatures,usd} from '@/lib/catalog';
import {billingMode,billingOffers} from '@/lib/billing';
import {startSubscription} from '@/app/app/billing/actions';
export const dynamic='force-dynamic';
export default function Pricing(){
 const enabled=paidPlansEnabled(),mode=billingMode(),offers=billingOffers();
 return <main className="marketing-page"><Brand /><section className="marketing-hero"><p className="eyebrow">YOUR BUSINESS, TOGETHER</p><h1>One workspace.<br/>Room to grow.</h1><p>Manage customers, projects, tasks and invoices with AI assistance. Prices are in USD.</p>{!enabled&&<p role="status">Paid subscriptions are not available yet.</p>}</section>
 <div className="grid cols3"><article className="card"><h2>Free</h2><p className="price">$0</p><p>20 AI messages and 3 website audit attempts per calendar month.</p><ul>{coreFeatures.map(f=><li key={f}>{f}</li>)}</ul><Link className="btn ghost" href="/signup">Start free</Link></article>{enabled&&hubPlans.map(p=>{const ready=!!mode&&offers.some(o=>o.plan===p.id&&o.cents===p.cents&&o.currency==='USD');return <article className="card" key={p.id}><h2>{p.name}</h2><p className="price">{usd(p.cents)}<span> / month</span></p><p>{p.description}</p><ul>{coreFeatures.map(f=><li key={f}>{f}</li>)}</ul><p>{p.messages.toLocaleString()} AI messages and {p.audits} audit attempts per calendar month.</p><form action={startSubscription}><input type="hidden" name="plan" value={p.id}/><label className="consent"><input type="checkbox" name="consent" value="yes" required/>I agree to {usd(p.cents)}/month, renewing automatically until cancelled.</label><button className="btn" disabled={!ready}>{mode==='sandbox'?'Test PayPal subscription':'Subscribe with PayPal'}</button>{!ready&&<p className="muted small">Payment setup is not available yet.</p>}</form></article>})}</div>
 {enabled&&<p>Allowances reset monthly and do not roll over. Failed AI and audit attempts count toward limits. Cancel future renewals from Plan &amp; billing. Verified access continues until the paid period ends, unless a refund or dispute pauses it. AI Builder is a separately billed add-on; <Link href="/app/addons">view details</Link>.</p>}</main>;
}
