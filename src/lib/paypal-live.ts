import { adminClient } from "./supabase/admin";
import { PayPalClient, paypalConfig } from "./paypal";
import type { SettleDeps } from "./payments";

/** Real dependencies for settleOrder (PayPal + the database). Kept apart so tests can use fakes. */
export function liveSettleDeps(paypal: PayPalClient): SettleDeps {
  return {
    paypal,
    async record(a) {
      const { data, error } = await adminClient().rpc("record_paypal_payment", {
        p_token: a.token,
        p_order_id: a.orderId,
        p_capture_id: a.captureId,
        p_amount_cents: a.amountCents,
        p_currency: a.currency,
      });
      if (error) throw new Error(`Could not record the payment: ${error.message}`);
      return String(data);
    },
  };
}

export function livePayPal(): PayPalClient | null {
  const cfg = paypalConfig();
  return cfg ? new PayPalClient(cfg) : null;
}
