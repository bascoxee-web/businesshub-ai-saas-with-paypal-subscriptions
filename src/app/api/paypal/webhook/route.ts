import { NextResponse } from "next/server";
import { processBillingEvent } from "@/lib/billing-live";
import { settleOrder } from "@/lib/payments";
import { livePayPal, liveSettleDeps } from "@/lib/paypal-live";

export const maxDuration = 120;

// Safety net for payers who approve in PayPal but close the tab before coming back.
// Set this URL (and the events CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED) in the
// PayPal developer dashboard, and put the webhook's id in PAYPAL_WEBHOOK_ID.
export async function POST(request: Request) {
  const paypal = livePayPal();
  if (!paypal) return NextResponse.json({ error: "PayPal is not configured" }, { status: 503 });

  if(Number(request.headers.get("content-length") ?? 0)>262144)return NextResponse.json({error:"Payload too large"},{status:413});
  const raw = await request.text();
  if(raw.length>262144)return NextResponse.json({error:"Payload too large"},{status:413});
  if (!(await paypal.verifyWebhook(request.headers, raw))) {
    return NextResponse.json({ error: "Signature check failed" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if(typeof event.id!=="string" || typeof event.event_type!=="string")return NextResponse.json({error:"Invalid event"},{status:400});
  try {
    const mode=process.env.PAYPAL_ENV;
    if((mode==="live"||mode==="sandbox") && await processBillingEvent(paypal,event,mode))return NextResponse.json({ok:true});
  }catch{ return NextResponse.json({error:"Subscription verification failed; retry"},{status:500}); }

  let orderId: string | undefined;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") orderId = event.resource?.id;
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") orderId = event.resource?.supplementary_data?.related_ids?.order_id;
  if (!orderId) return NextResponse.json({ ok: true, ignored: true });

  try {
    const result = await settleOrder(String(orderId), liveSettleDeps(paypal));
    if (result.outcome === "amount_mismatch" || result.outcome === "not_found") {
      console.error("paypal webhook: needs attention", result.outcome, orderId);
    }
    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch (e) {
    console.error("paypal webhook failed", e instanceof Error ? e.message : e);
    // A non-2xx answer makes PayPal retry later.
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }
}
