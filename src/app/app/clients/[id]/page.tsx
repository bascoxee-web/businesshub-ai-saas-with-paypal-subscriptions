import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { uuid } from "@/lib/schemas";
import { invoiceTotals } from "@/lib/data";
import { formatMoney, formatInvoiceNumber } from "@/lib/money";
import { Banner } from "@/components/Banner";
import { ClientForm } from "@/components/ClientForm";
import { updateClientAction, addNoteAction, deleteClientAction } from "../actions";

export const metadata = { title: "Client" };

export default async function ClientPage({
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

  const { data: client } = await supabase.from("clients").select("id, name, email, phone, company, status").eq("id", id).maybeSingle();
  if (!client) notFound();

  const [notes, projects, invoices, totals] = await Promise.all([
    supabase.from("client_notes").select("id, body, created_at").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("projects").select("id, name, status").eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, number, status").eq("client_id", id).order("number", { ascending: false }),
    invoiceTotals(supabase),
  ]);

  return (
    <>
      <div className="row between">
        <h1>{client.name}</h1>
        <Link className="btn" href={`/app/invoices/new?client=${client.id}`}>New invoice</Link>
      </div>
      <Banner error={sp.error} notice={sp.notice} />

      <div className="card u-max-width-680px" >
        <h2>Details</h2>
        <ClientForm action={updateClientAction.bind(null, id)} client={client} submitLabel="Save changes" />
      </div>

      <div className="card u-max-width-680px" >
        <h2>Notes</h2>
        <form action={addNoteAction.bind(null, id)} className="u-margin-bottom-12px">
          <div className="field"><textarea name="body" placeholder="Call summary, preferences, next steps…" required maxLength={2000} /></div>
          <button className="btn dark small" type="submit">Add note</button>
        </form>
        {(notes.data ?? []).length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          (notes.data ?? []).map((n) => (
            <div key={n.id} className="u-border-top-1px-solid-var-line-padding-10px-0-white-space-pre-wrap">
              {n.body}
              <div className="muted small">{new Date(n.created_at).toLocaleString("en-US")}</div>
            </div>
          ))
        )}
      </div>

      <div className="card u-max-width-680px" >
        <h2>Projects</h2>
        {(projects.data ?? []).length === 0 ? <p className="muted">No projects for this client.</p> : (
          <ul className="u-padding-left-18px-margin-0">
            {(projects.data ?? []).map((p) => (
              <li key={p.id}><Link href={`/app/projects/${p.id}`}>{p.name}</Link> <span className="pill">{p.status}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="card u-max-width-680px" >
        <h2>Invoices</h2>
        {(invoices.data ?? []).length === 0 ? <p className="muted">No invoices yet.</p> : (
          <table>
            <tbody>
              {(invoices.data ?? []).map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/app/invoices/${i.id}`}>{formatInvoiceNumber(i.number)}</Link></td>
                  <td><span className="pill">{i.status}</span></td>
                  <td className="num">{formatMoney(totals.get(i.id) ?? 0, ws.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form action={deleteClientAction.bind(null, id)}>
        <button className="btn danger small" type="submit">Delete client</button>
      </form>
    </>
  );
}
