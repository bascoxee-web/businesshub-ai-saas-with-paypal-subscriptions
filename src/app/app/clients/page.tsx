import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Clients" };

const STATUS_PILL: Record<string, string> = { lead: "warn", active: "ok", inactive: "" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; q?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireWorkspace();
  let query = supabase.from("clients").select("id, name, email, company, status").order("created_at", { ascending: false }).limit(500);
  const q = sp.q?.trim().replace(/[%,()*\\]/g, " ").slice(0, 60);
  if (q) query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`);
  const { data: clients } = await query;

  return (
    <>
      <div className="row between">
        <h1>Clients</h1>
        <Link className="btn" href="/app/clients/new">New client</Link>
      </div>
      <Banner error={sp.error} notice={sp.notice} />
      <form className="row" style={{ marginBottom: 14 }}>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, company or email" style={{ maxWidth: 340 }} />
        <button className="btn ghost" type="submit">Search</button>
      </form>
      <div className="card">
        {(clients ?? []).length === 0 ? (
          <div className="empty">{q ? "No clients match that search." : "No clients yet."}</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>
              {(clients ?? []).map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/app/clients/${c.id}`}><strong>{c.name}</strong></Link></td>
                  <td>{c.company ?? ""}</td>
                  <td className="muted">{c.email ?? ""}</td>
                  <td><span className={`pill ${STATUS_PILL[c.status] ?? ""}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
