import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { uuid } from "@/lib/schemas";
import { siteUrl } from "@/lib/site";
import { formatMoney, formatInvoiceNumber, invoiceTotalCents, lineTotalCents } from "@/lib/money";
import { isOverdue, nextActions, todayISO, type InvoiceStatus } from "@/lib/invoice-status";
import { Banner } from "@/components/Banner";
import { setInvoiceStatusAction, deleteInvoiceAction } from "../actions";

export const metadata = { title: "Invoice" };

const ACTION_LABEL: Record<InvoiceStatus, string> = {
  draft: "Move back to draft",
  sent: "Mark as sent",
  paid: "Mark as paid",
  void: "Void invoice",
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const { supabase, ws } = await requireWorkspace();

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, number, status, currency, issue_date, due_date, notes, public_token, client_id, sent_at")
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();

  const [{ data: items }, { data: client }, { data: payments }] = await Promise.all([
    supabase.from("invoice_items").select("id, description, quantity, unit_price_cents").eq("invoice_id", id).order("position"),
    supabase.from("clients").select("id, name, company, email").eq("id", inv.client_id).maybeSingle(),
    supabase.from("invoice_payments").select("id, provider, provider_order_id, amount_cents, currency, created_at").eq("invoice_id", id).order("created_at"),
  ]);
  const lines = (items ?? []).map((it) => ({ ...it, quantity: Number(it.quantity), unit_price_cents: Number(it.unit_price_cents) }));
  const total = invoiceTotalCents(lines);
  const status = inv.status as InvoiceStatus;
  const overdue = isOverdue(status, inv.due_date, todayISO());
  const shareable = status === "sent" || status === "paid";
  const publicUrl = shareable ? `${await siteUrl()}/i/${inv.public_token}` : null;

  return (
    <>
      <div className="row between">
        <h1>{formatInvoiceNumber(inv.number)}</h1>
        <span className={`pill ${overdue ? "bad" : status === "paid" ? "ok" : status === "sent" ? "warn" : ""}`}>{overdue ? "overdue" : status}</span>
      </div>
      <Banner error={sp.error} notice={sp.notice} />

      <div className="card u-max-width-760px" >
        <div className="row between u-align-items-flex-start" >
          <div>
            <div className="muted small">Bill to</div>
            {client ? <Link href={`/app/clients/${client.id}`}><strong>{client.name}</strong></Link> : null}
            {client?.company ? <div>{client.company}</div> : null}
            {client?.email ? <div className="muted">{client.email}</div> : null}
          </div>
          <div className="u-text-align-right">
            <div className="muted small">Issued</div><div>{inv.issue_date}</div>
            <div className="muted small u-margin-top-6px" >Due</div><div>{inv.due_date ?? "—"}</div>
          </div>
        </div>
        <table className="u-margin-top-14px">
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatMoney(l.unit_price_cents, inv.currency)}</td>
                <td className="num">{formatMoney(lineTotalCents(l.quantity, l.unit_price_cents), inv.currency)}</td>
              </tr>
            ))}
            <tr><td colSpan={3} className="num"><strong>Total</strong></td><td className="num"><strong>{formatMoney(total, inv.currency)}</strong></td></tr>
          </tbody>
        </table>
        {inv.notes ? <p className="muted u-white-space-pre-wrap" >{inv.notes}</p> : null}
      </div>

      {(payments ?? []).length > 0 && (
        <div className="card u-max-width-760px" >
          <h2>Payments received</h2>
          <table>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td>PayPal</td>
                  <td className="muted small">{p.provider_order_id}</td>
                  <td className="muted">{new Date(p.created_at).toLocaleString("en-US")}</td>
                  <td className="num">{formatMoney(Number(p.amount_cents), p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(payments ?? []).length > 1 || status === "void" ? (
            <p className="small u-color-var-warn-margin-bottom-0" >
              This invoice has more than one payment, or was voided after being paid. Check PayPal and refund anything extra.
            </p>
          ) : null}
        </div>
      )}

      {publicUrl && (
        <div className="card u-max-width-760px" >
          <h2>Share with your client</h2>
          <p className="muted small">Anyone with this link can view this invoice. Send it by email or message.</p>
          <input readOnly value={publicUrl} aria-label="Public invoice link" />
          <p className="u-margin-bottom-0"><a className="btn ghost small" href={publicUrl} target="_blank" rel="noopener noreferrer">Open page</a></p>
        </div>
      )}

      <div className="row">
        {nextActions(status).filter(to => !(to === "draft" && inv.sent_at) && !(status === "paid" && to === "sent" && (payments ?? []).length > 0)).map((to) => (
          <form key={to} action={setInvoiceStatusAction.bind(null, id, to)}>
            <button className={`btn ${to === "void" ? "danger" : to === "draft" ? "ghost" : ""}`} type="submit">{ACTION_LABEL[to]}</button>
          </form>
        ))}
        {(status === "draft" || status === "void") && !inv.sent_at && (
          <form action={deleteInvoiceAction.bind(null, id)}>
            <button className="btn danger" type="submit">Delete</button>
          </form>
        )}
      </div>
      {ws.currency !== inv.currency && <p className="muted small">This invoice was issued in {inv.currency}.</p>}
    </>
  );
}
