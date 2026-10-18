import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { invoiceTotals, clientNames } from "@/lib/data";
import { formatMoney, formatInvoiceNumber } from "@/lib/money";
import { isOverdue, todayISO } from "@/lib/invoice-status";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireWorkspace();
  const [{ data }, totals] = await Promise.all([
    supabase.from("invoices").select("id, number, status, issue_date, due_date, client_id").order("number", { ascending: false }).limit(500),
    invoiceTotals(supabase),
  ]);
  const list = data ?? [];
  const names = await clientNames(supabase, list.map((i) => i.client_id));
  const today = todayISO();

  return (
    <>
      <div className="row between">
        <h1>Invoices</h1>
        <Link className="btn" href="/app/invoices/new">New invoice</Link>
      </div>
      <Banner error={sp.error} notice={sp.notice} />
      <div className="card">
        {list.length === 0 ? <div className="empty">No invoices yet.</div> : (
          <table>
            <thead><tr><th>Number</th><th>Client</th><th>Due</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {list.map((i) => {
                const overdue = isOverdue(i.status, i.due_date, today);
                const pill = overdue ? "bad" : i.status === "paid" ? "ok" : i.status === "sent" ? "warn" : "";
                return (
                  <tr key={i.id}>
                    <td><Link href={`/app/invoices/${i.id}`}><strong>{formatInvoiceNumber(i.number)}</strong></Link></td>
                    <td>{names.get(i.client_id) ?? ""}</td>
                    <td className="muted">{i.due_date ?? ""}</td>
                    <td><span className={`pill ${pill}`}>{overdue ? "overdue" : i.status}</span></td>
                    <td className="num">{formatMoney(totals.get(i.id) ?? 0, ws.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
