import type { SupabaseClient } from "@supabase/supabase-js";
import { clientNames, invoiceTotals } from "../data";
import type { ProposalKind } from "./proposals";

export type Row = Record<string, string | number | null>;

/** Everything the assistant is allowed to touch. The real one runs as the signed-in user. */
export interface AssistantRepo {
  searchClients(a: { query?: string; status?: string }): Promise<Row[]>;
  listProjects(a: { status?: string; client_id?: string }): Promise<Row[]>;
  listTasks(a: { project_id?: string; status?: string }): Promise<Row[]>;
  listInvoices(a: { status?: string; client_id?: string }): Promise<Row[]>;
  findClient(id: string): Promise<{ id: string; name: string } | null>;
  findProject(id: string): Promise<{ id: string; name: string } | null>;
  saveProposal(p: { kind: ProposalKind; summary: string; payload: unknown }): Promise<{ id: string }>;
}

const LIMIT = 25;

/** Removes characters that have meaning inside a PostgREST filter string. */
export function safeSearch(q: string): string {
  return q.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 60);
}

export function supabaseRepo(supabase: SupabaseClient<any, "businesshub">, ws: { id: string }, userId: string): AssistantRepo {
  return {
    async searchClients({ query, status }) {
      let q = supabase.from("clients").select("id, name, email, phone, company, status").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(LIMIT);
      if (status) q = q.eq("status", status);
      const s = query ? safeSearch(query) : "";
      if (s) q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) throw new Error("Could not search clients");
      return data ?? [];
    },
    async listProjects({ status, client_id }) {
      let q = supabase.from("projects").select("id, name, status, due_date, client_id").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(LIMIT);
      if (status) q = q.eq("status", status);
      if (client_id) q = q.eq("client_id", client_id);
      const { data, error } = await q;
      if (error) throw new Error("Could not list projects");
      return data ?? [];
    },
    async listTasks({ project_id, status }) {
      let q = supabase.from("tasks").select("id, title, status, due_date, project_id").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(LIMIT);
      if (project_id) q = q.eq("project_id", project_id);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw new Error("Could not list tasks");
      return data ?? [];
    },
    async listInvoices({ status, client_id }) {
      let q = supabase.from("invoices").select("id, number, status, due_date, issue_date, client_id").eq("workspace_id", ws.id).order("number", { ascending: false }).limit(LIMIT);
      if (status) q = q.eq("status", status);
      if (client_id) q = q.eq("client_id", client_id);
      const { data, error } = await q;
      if (error) throw new Error("Could not list invoices");
      const rows = data ?? [];
      const [totals, names] = await Promise.all([invoiceTotals(supabase), clientNames(supabase, rows.map((r) => r.client_id))]);
      return rows.map((r) => ({ ...r, client_name: names.get(r.client_id) ?? null, total_cents: totals.get(r.id) ?? 0 }));
    },
    async findClient(id) {
      const { data } = await supabase.from("clients").select("id, name").eq("workspace_id", ws.id).eq("id", id).maybeSingle();
      return data ?? null;
    },
    async findProject(id) {
      const { data } = await supabase.from("projects").select("id, name").eq("workspace_id", ws.id).eq("id", id).maybeSingle();
      return data ?? null;
    },
    async saveProposal({ kind, summary, payload }) {
      const { data, error } = await supabase
        .from("ai_proposals")
        .insert({ workspace_id: ws.id, user_id: userId, kind, summary: summary.slice(0, 500), payload })
        .select("id")
        .single();
      if (error || !data) throw new Error("Could not save the proposal");
      return { id: data.id };
    },
  };
}
