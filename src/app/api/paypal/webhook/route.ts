import { NextResponse } from "next/server";
import { settleOrder } from "@/lib/payments";
import { livePayPal, liveSettleDeps } from "@/lib/paypal-live";

// Safety net for payers who approve in PayPal but close the tab before coming back.
// Set this URL (and the events CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED) in the
// PayPal developer dashboard, and put the webhook's id in PAYPAL_WEBHOOK_ID.
export async function POST(request: Request) {
  const paypal = livePayPal();
  if (!paypal) return NextResponse.json({ error: "PayPal is not configured" }, { status: 503 });

  const raw = await request.text();
  if (!(await paypal.verifyWebhook(request.headers, raw))) {
    return NextResponse.json({ error: "Signature check failed" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

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
