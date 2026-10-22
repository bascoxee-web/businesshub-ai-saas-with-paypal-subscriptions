import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { Banner } from "@/components/Banner";
import { LineItemsEditor } from "@/components/LineItemsEditor";
import { createInvoiceAction } from "../actions";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ error?: string; client?: string }> }) {
  const sp = await searchParams;
  const { supabase, ws } = await requireWorkspace();
  const { data: clients } = await supabase.from("clients").select("id, name, company").order("name").limit(500);

  if ((clients ?? []).length === 0) {
    return (
      <>
        <h1>New invoice</h1>
        <div className="card empty">
          <p>You need a client before you can invoice anyone.</p>
          <Link className="btn" href="/app/clients/new">Add a client</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>New invoice</h1>
      <Banner error={sp.error} />
      <form action={createInvoiceAction} className="card u-max-width-760px" >
        <div className="row u-align-items-flex-start" >
          <div className="field u-flex-2-min-width-220px" >
            <label htmlFor="client_id">Client</label>
            <select id="client_id" name="client_id" defaultValue={sp.client ?? ""} required>
              <option value="" disabled>Choose a client</option>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="field u-flex-1-min-width-150px" >
            <label htmlFor="due_date">Due date</label>
            <input id="due_date" name="due_date" type="date" />
          </div>
        </div>
        <LineItemsEditor currency={ws.currency} />
        <div className="field u-margin-top-14px" >
          <label htmlFor="notes">Notes (shown on the invoice)</label>
          <textarea id="notes" name="notes" maxLength={1000} placeholder="Payment instructions, thank-you note…" />
        </div>
        <button className="btn" type="submit">Save as draft</button>
      </form>
    </>
  );
}
