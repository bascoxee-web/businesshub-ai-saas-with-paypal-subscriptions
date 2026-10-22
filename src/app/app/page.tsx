import Link from "next/link";
import {Brand} from "@/components/Brand";
import { requireWorkspace } from "@/lib/auth";
import { invoiceTotals, clientNames } from "@/lib/data";
import { formatMoney, formatInvoiceNumber } from "@/lib/money";
import { isOverdue, todayISO } from "@/lib/invoice-status";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireWorkspace();
  const today = todayISO();

  const [clients, projects, openTasks, invoices, totals] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
    supabase.from("invoices").select("id, number, status, due_date, client_id, paid_at").order("created_at", { ascending: false }),
    invoiceTotals(supabase),
  ]);
  const inv = invoices.data ?? [];
  const sum = (rows: typeof inv) => rows.reduce((s, r) => s + (totals.get(r.id) ?? 0), 0);

  const outstanding = inv.filter((i) => i.status === "sent");
  const overdue = outstanding.filter((i) => isOverdue(i.status, i.due_date, today));
  const monthStart = `${today.slice(0, 7)}-01`;
  const paidThisMonth = inv.filter((i) => i.status === "paid" && i.paid_at && i.paid_at.slice(0, 10) >= monthStart);

  const names = await clientNames(supabase, overdue.map((i) => i.client_id));

  return (
    <>
      <div className="dashboard-heading"><Brand /><div className="row between"><h1>Dashboard</h1><Link className="pill" href="/app/billing">Current plan: {ws.plan}</Link></div></div>
      <Banner error={sp.error} notice={sp.notice} />
      <div className="grid cols3 u-margin-bottom-16px" >
        <div className="card stat"><div className="muted small">Clients</div><div className="n">{clients.count ?? 0}</div></div>
        <div className="card stat"><div className="muted small">Active projects</div><div className="n">{projects.count ?? 0}</div></div>
        <div className="card stat"><div className="muted small">Open tasks</div><div className="n">{openTasks.count ?? 0}</div></div>
        <div className="card stat"><div className="muted small">Outstanding</div><div className="n">{formatMoney(sum(outstanding), ws.currency)}</div></div>
        <div className="card stat"><div className="muted small">Overdue</div><div className={overdue.length ? "n text-danger" : "n"}>{formatMoney(sum(overdue), ws.currency)}</div></div>
        <div className="card stat"><div className="muted small">Paid this month</div><div className="n">{formatMoney(sum(paidThisMonth), ws.currency)}</div></div>
      </div>

      {overdue.length > 0 && (
        <div className="card">
          <h2>Overdue invoices</h2>
          <table>
            <tbody>
              {overdue.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/app/invoices/${i.id}`}>{formatInvoiceNumber(i.number)}</Link></td>
                  <td>{names.get(i.client_id) ?? ""}</td>
                  <td className="muted">due {i.due_date}</td>
                  <td className="num">{formatMoney(totals.get(i.id) ?? 0, ws.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(clients.count ?? 0) === 0 && (
        <div className="card empty">
          <p>Nothing here yet. Start by adding your first client, or ask the AI Assistant to do it for you.</p>
          <Link className="btn" href="/app/clients/new">Add a client</Link>{" "}
          <Link className="btn ghost" href="/app/assistant">Open the assistant</Link>
        </div>
      )}
    </>
  );
}
