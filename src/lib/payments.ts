import { uuid } from "./schemas";
import type { Order } from "./paypal";

export type SettleOutcome =
  | "paid" // invoice marked paid
  | "already_recorded" // this order was handled before
  | "recorded_invoice_not_open" // money arrived, but the invoice was already paid or voided
  | "pending" // PayPal has not completed the payment (yet)
  | "ignored" // not one of ours
  | "amount_mismatch"
  | "not_found";

export type SettleResult = { outcome: SettleOutcome; invoiceToken?: string };

export type SettleDeps = {
  paypal: { getOrder(id: string): Promise<Order>; captureOrder(id: string): Promise<Order> };
  /** Calls record_paypal_payment with the service-role client. Returns the function's result code. */
  record(a: { token: string; orderId: string; captureId: string | null; amountCents: number; currency: string }): Promise<string>;
};

/**
 * Brings one PayPal order to its end state. Safe to run any number of times and from several
 * places at once (return page and webhook): capture is idempotent and recording is too.
 * Nothing is trusted from the browser or the webhook body except the order id; the order itself
 * is read from PayPal with our own credentials.
 */
export async function settleOrder(orderId: string, deps: SettleDeps): Promise<SettleResult> {
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(orderId)) return { outcome: "ignored" };

  let order = await deps.paypal.getOrder(orderId);
  if (order.status === "APPROVED") order = await deps.paypal.captureOrder(orderId);
  if (order.status !== "COMPLETED") return { outcome: "pending" };
  // A completed order can still hold a capture that is waiting on funds (for example an eCheck).
  if (order.captureStatus !== "COMPLETED") return { outcome: "pending" };

  if (!order.customId || !uuid.safeParse(order.customId).success) return { outcome: "ignored" };
  if (order.amountCents === undefined || !order.currency) return { outcome: "ignored" };

  const code = await deps.record({
    token: order.customId,
    orderId,
    captureId: order.captureId ?? null,
    amountCents: order.amountCents,
    currency: order.currency,
  });
  const known: SettleOutcome[] = ["paid", "already_recorded", "recorded_invoice_not_open", "amount_mismatch", "not_found"];
  if (!known.includes(code as SettleOutcome)) throw new Error(`Unexpected result from record_paypal_payment: ${code}`);
  return { outcome: code as SettleOutcome, invoiceToken: order.customId };
}
