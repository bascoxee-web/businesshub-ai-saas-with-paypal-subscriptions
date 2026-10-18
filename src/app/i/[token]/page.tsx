import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/schemas";
import { formatMoney, formatInvoiceNumber } from "@/lib/money";
import { PrintButton } from "@/components/PrintButton";
import { Banner } from "@/components/Banner";
import { PAYPAL_CURRENCIES, paypalConfig } from "@/lib/paypal";
import { startPayPalCheckout } from "./actions";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type PublicInvoice = {
  number: number;
  status: "sent" | "paid";
  currency: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  business_name: string;
  paypal_enabled?: boolean;
  client_name: string;
  client_company: string | null;
  items: { description: string; quantity: number; unit_price_cents: number; line_total_cents: number }[];
};

export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; notice?: string; paid?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(token).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_invoice", { p_token: token });
  if (error || !data) notFound();
  const inv = data as PublicInvoice;
  const total = inv.items.reduce((s, it) => s + Number(it.line_total_cents), 0);
  const canPay = inv.status === "sent" && !!inv.paypal_enabled && total > 0 && PAYPAL_CURRENCIES.includes(inv.currency) && !!paypalConfig();

  return (
    <div className="invoice-page">
      <div className="no-print">
        <Banner error={sp.error} notice={sp.paid === "1" ? "Payment received. Thank you!" : sp.notice} />
      </div>
      <div className="card">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <h1 style={{ marginBottom: 2 }}>{inv.business_name}</h1>
            <div className="muted">Invoice {formatInvoiceNumber(inv.number)}</div>
          </div>
          <span className={`pill ${inv.status === "paid" ? "ok" : "warn"}`}>{inv.status === "paid" ? "Paid" : "Payment due"}</span>
        </div>

        <div className="row between" style={{ margin: "22px 0", alignItems: "flex-start" }}>
          <div>
            <div className="muted small">Bill to</div>
            <strong>{inv.client_name}</strong>
            {inv.client_company ? <div>{inv.client_company}</div> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted small">Issued</div><div>{inv.issue_date}</div>
            <div className="muted small" style={{ marginTop: 6 }}>Due</div><div>{inv.due_date ?? "On receipt"}</div>
          </div>
        </div>

        <table>
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i}>
                <td>{it.description}</td>
                <td className="num">{Number(it.quantity)}</td>
                <td className="num">{formatMoney(Number(it.unit_price_cents), inv.currency)}</td>
                <td className="num">{formatMoney(Number(it.line_total_cents), inv.currency)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="num"><strong>Total</strong></td>
              <td className="num"><strong>{formatMoney(total, inv.currency)}</strong></td>
            </tr>
          </tbody>
        </table>

        {inv.notes ? <p style={{ whiteSpace: "pre-wrap", marginTop: 20 }}>{inv.notes}</p> : null}
        <div className="no-print row" style={{ marginTop: 24 }}>
          {canPay && (
            <form action={startPayPalCheckout.bind(null, token)}>
              <button className="btn" type="submit">Pay {formatMoney(total, inv.currency)} with PayPal</button>
            </form>
          )}
          <PrintButton />
        </div>
      </div>
    </div>
  );
}
