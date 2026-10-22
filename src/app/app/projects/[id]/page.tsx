import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { uuid } from "@/lib/schemas";
import { todayISO } from "@/lib/invoice-status";
import { Banner } from "@/components/Banner";
import { addTaskAction, moveTaskAction, deleteTaskAction, setProjectStatusAction, deleteProjectAction } from "../actions";

export const metadata = { title: "Project" };

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
] as const;

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const { supabase } = await requireWorkspace();

  const { data: project } = await supabase.from("projects").select("id, name, status, due_date, client_id").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [{ data: tasks }, clientRes] = await Promise.all([
    supabase.from("tasks").select("id, title, status, due_date").eq("project_id", id).order("created_at"),
    project.client_id ? supabase.from("clients").select("id, name").eq("id", project.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const today = todayISO();

  return (
    <>
      <div className="row between">
        <div>
          <h1>{project.name}</h1>
          <div className="muted">
            {clientRes.data ? <>Client: <Link href={`/app/clients/${clientRes.data.id}`}>{clientRes.data.name}</Link></> : "No client"}
            {project.due_date ? <> · due {project.due_date}</> : null}
          </div>
        </div>
        <form action={setProjectStatusAction.bind(null, id)} className="row">
          <select name="status" defaultValue={project.status} className="u-width-auto" aria-label="Project status">
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
          <button className="btn ghost small" type="submit">Update</button>
        </form>
      </div>
      <Banner error={sp.error} notice={sp.notice} />

      <div className="card">
        <form action={addTaskAction.bind(null, id)} className="row u-align-items-flex-end" >
          <div className="u-flex-1-min-width-220px">
            <label htmlFor="title">New task</label>
            <input id="title" name="title" required maxLength={200} />
          </div>
          <div className="u-min-width-150px">
            <label htmlFor="due_date">Due</label>
            <input id="due_date" name="due_date" type="date" />
          </div>
          <button className="btn" type="submit">Add task</button>
        </form>
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const items = (tasks ?? []).filter((t) => t.status === col.key);
          return (
            <div className="col" key={col.key}>
              <h3>{col.label} ({items.length})</h3>
              {items.map((t) => (
                <div className="task" key={t.id}>
                  <div>{t.title}</div>
                  {t.due_date && (
                    <div className={`small ${t.status !== "done" && t.due_date < today ? "text-danger" : "muted"}`}>
                      due {t.due_date}
                    </div>
                  )}
                  <div className="acts">
                    {COLUMNS.filter((c) => c.key !== col.key).map((c) => (
                      <form key={c.key} action={moveTaskAction.bind(null, id, t.id, c.key)}>
                        <button className="btn ghost small" type="submit">→ {c.label}</button>
                      </form>
                    ))}
                    <form action={deleteTaskAction.bind(null, id, t.id)}>
                      <button className="btn danger small" type="submit" aria-label={`Delete task ${t.title}`}>Delete</button>
                    </form>
                  </div>
                </div>
              ))}
              {items.length === 0 && <div className="muted small">Nothing here</div>}
            </div>
          );
        })}
      </div>

      <form action={deleteProjectAction.bind(null, id)} className="u-margin-top-24px">
        <button className="btn danger small" type="submit">Delete project and its tasks</button>
      </form>
    </>
  );
}
