"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/schemas";
import { siteUrl } from "@/lib/site";
import { PAYPAL_CURRENCIES } from "@/lib/paypal";
import { livePayPal } from "@/lib/paypal-live";
import { formatInvoiceNumber } from "@/lib/money";

function back(token: string, error: string): never {
  redirect(`/i/${token}?error=${encodeURIComponent(error)}`);
}

/** Starts a PayPal checkout for a public invoice. No sign-in: anyone with the link may pay it. */
export async function startPayPalCheckout(token: string) {
  if (!uuid.safeParse(token).success) redirect("/");

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_invoice", { p_token: token });
  const inv = data as {
    number: number;
    status: string;
    currency: string;
    business_name: string;
    paypal_enabled: boolean;
    items: { line_total_cents: number | string }[];
  } | null;
  if (!inv) redirect("/");

  const paypal = livePayPal();
  if (!inv.paypal_enabled || !paypal) back(token, "Online payment isn't available for this invoice.");
  if (inv.status !== "sent") back(token, inv.status === "paid" ? "This invoice has already been paid." : "This invoice can't be paid right now.");
  if (!PAYPAL_CURRENCIES.includes(inv.currency)) back(token, `PayPal checkout doesn't support ${inv.currency} here.`);

  const amountCents = inv.items.reduce((s, i) => s + Number(i.line_total_cents), 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) back(token, "There is nothing to pay on this invoice.");

  let approveUrl: string;
  try {
    const base = await siteUrl();
    ({ approveUrl } = await paypal.createOrder({
      invoiceToken: token,
      description: `Invoice ${formatInvoiceNumber(inv.number)} from ${inv.business_name}`,
      amountCents,
      currency: inv.currency,
      businessName: inv.business_name,
      returnUrl: `${base}/i/${token}/paypal/return`,
      cancelUrl: `${base}/i/${token}?notice=${encodeURIComponent("Payment cancelled. You can try again any time.")}`,
    }));
  } catch (e) {
    console.error("paypal createOrder failed", e instanceof Error ? e.message : e);
    back(token, "We couldn't reach PayPal. Please try again in a moment.");
  }
  redirect(approveUrl);
}
