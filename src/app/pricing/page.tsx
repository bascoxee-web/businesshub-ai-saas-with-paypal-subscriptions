import Link from 'next/link';
import {billingMode,billingOffers} from '@/lib/billing';
import {aiMessageLimit} from '@/lib/plans';
export const dynamic='force-dynamic';
export default function Pricing(){
 const live=billingMode()==='live';
 return <main style={{maxWidth:900,margin:'auto',padding:'40px 20px'}}><h1>Plans for your workspace</h1><div className="card"><h2>Free</h2><p>20 AI messages and 3 live website audit attempts per calendar month, with clients, projects, tasks and invoices.</p><Link className="btn" href="/signup">Create free account</Link></div>
 {live?billingOffers().map(p=><div className="card" key={p.plan}><h2>{p.plan}</h2><p><strong>{p.currency} {(p.cents/100).toFixed(2)} per month</strong>, automatically renewed until cancelled.</p><p>{aiMessageLimit(p.plan)} AI messages and {({starter:20,growth:100,business:300})[p.plan]} live website audit attempts per calendar month. Limits reset by calendar month; unused allowance does not roll over. Audit attempts include retrieval failures.</p><Link className="btn" href="/app/billing">View billing and subscribe</Link></div>):<p>Paid subscriptions are not available for purchase yet. Sandbox testing does not activate paid access.</p>}
 <p>Cancel future payments in your workspace or PayPal. Verified paid access continues to the end of the paid period; refunds and disputes may pause paid features.</p><Link href="/">Back to BusinessHub</Link></main>;
}
