import { NextResponse, type NextRequest } from "next/server";
import { uuid } from "@/lib/schemas";
import { settleOrder } from "@/lib/payments";
import { livePayPal, liveSettleDeps } from "@/lib/paypal-live";

// PayPal sends the payer back here after they approve. We confirm and capture the payment with
// PayPal ourselves; the address only tells us which order to look at.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  if (!uuid.safeParse(token).success) return NextResponse.redirect(`${origin}/`);
  const to = (query: string) => NextResponse.redirect(`${origin}/i/${token}?${query}`);

  const orderId = request.nextUrl.searchParams.get("token");
  const paypal = livePayPal();
  if (!orderId || !paypal) return to(`error=${encodeURIComponent("We couldn't confirm the payment.")}`);

  try {
    const result = await settleOrder(orderId, liveSettleDeps(paypal));
    if (result.invoiceToken && result.invoiceToken !== token) {
      return to(`error=${encodeURIComponent("That payment belongs to a different invoice.")}`);
    }
    switch (result.outcome) {
      case "paid":
      case "already_recorded":
      case "recorded_invoice_not_open":
        return to("paid=1");
      case "pending":
        return to(`notice=${encodeURIComponent("Your payment is still being processed by PayPal. This page will show Paid once it clears.")}`);
      default:
        console.error("paypal return: unexpected outcome", result.outcome, orderId);
        return to(`error=${encodeURIComponent("We couldn't match that payment to this invoice. Please contact the sender.")}`);
    }
  } catch (e) {
    console.error("paypal return failed", e instanceof Error ? e.message : e);
    return to(`error=${encodeURIComponent("Something went wrong confirming your payment. If you were charged, the sender will see it shortly.")}`);
  }
}
