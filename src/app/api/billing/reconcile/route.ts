import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {adminClient} from '@/lib/supabase/admin';
import {livePayPal} from '@/lib/paypal-live';
import {reconcileBilling} from '@/lib/billing-live';
export const maxDuration=300;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;const auth=request.headers.get('authorization')??'';
 const expected=`Bearer ${secret}`;
 if(!secret||Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});
 const paypal=livePayPal();const mode=process.env.PAYPAL_ENV;if(!paypal||!['live','sandbox'].includes(mode??''))return NextResponse.json({error:'Not configured'},{status:503});
 const admin=adminClient();
 const rows=await admin.from('billing_subscriptions').select('*').eq('environment',mode).not('provider_id','is',null).order('verified_at',{ascending:true,nullsFirst:true}).limit(101);
 if(rows.error)return NextResponse.json({error:'Database unavailable'},{status:503});
 // Pilot cap is explicit; don't silently claim every account was checked.
 if(rows.data.length>100)return NextResponse.json({error:'Reconciliation capacity exceeded; configure paginated worker before growing beyond 100 subscriptions'},{status:503});
 let failures=0;
 for(let i=0;i<rows.data.length;i+=3)await Promise.all(rows.data.slice(i,i+3).map(async row=>{try{await reconcileBilling(paypal,row)}catch{failures++}}));
 return NextResponse.json({checked:rows.data.length,failures},{status:failures?503:200});
}
