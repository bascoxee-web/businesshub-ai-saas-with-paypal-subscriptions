import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { clientNames } from "@/lib/data";
import { Banner } from "@/components/Banner";
import { createProjectAction } from "./actions";

export const metadata = { title: "Projects" };

const PILL: Record<string, string> = { planned: "", active: "ok", done: "warn" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireWorkspace();
  const [{ data: projects }, { data: clients }] = await Promise.all([
    supabase.from("projects").select("id, name, status, due_date, client_id").order("created_at", { ascending: false }).limit(500),
    supabase.from("clients").select("id, name").order("name").limit(500),
  ]);
  const list = projects ?? [];
  const names = await clientNames(supabase, list.map((p) => p.client_id).filter((v): v is string => !!v));

  return (
    <>
      <h1>Projects</h1>
      <Banner error={sp.error} notice={sp.notice} />
      <div className="card">
        <h2>New project</h2>
        <form action={createProjectAction} className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required maxLength={120} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="client_id">Client</label>
            <select id="client_id" name="client_id" defaultValue="">
              <option value="">No client</option>
              {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label htmlFor="due_date">Due date</label>
            <input id="due_date" name="due_date" type="date" />
          </div>
          <button className="btn" type="submit">Create</button>
        </form>
      </div>
      <div className="card">
        {list.length === 0 ? <div className="empty">No projects yet.</div> : (
          <table>
            <thead><tr><th>Project</th><th>Client</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/projects/${p.id}`}><strong>{p.name}</strong></Link></td>
                  <td>{p.client_id ? (names.get(p.client_id) ?? "") : <span className="muted">—</span>}</td>
                  <td className="muted">{p.due_date ?? ""}</td>
                  <td><span className={`pill ${PILL[p.status] ?? ""}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
