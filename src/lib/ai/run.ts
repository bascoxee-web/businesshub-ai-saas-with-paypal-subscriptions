import { z } from "zod";
import { clientSchema, noteSchema, taskSchema, invoiceSchema, firstError, uuid } from "../schemas";
import { formatMoney, invoiceTotalCents } from "../money";
import { payloadSchemas, type ProposalKind } from "./proposals";
import { TOOLS, proposeInputs, readInputSchemas } from "./tools";
import type { AssistantRepo } from "./repo";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
export type LlmResponse = { content: Block[]; stop_reason?: string | null };
/** Provider-neutral interface for the bounded assistant tool loop and test doubles. */
export type LlmClient = { messages: { create(params: Record<string, unknown>): Promise<LlmResponse> } };

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ProposalCard = { id: string; kind: ProposalKind; summary: string };
export type AssistantResult = { reply: string; proposals: ProposalCard[] };

const MAX_STEPS = 6;
const FALLBACK = "I couldn't finish that in one go. Could you try a more specific request?";

type ToolOutcome = { content: string; isError: boolean };
const ok = (data: unknown): ToolOutcome => ({ content: JSON.stringify(data), isError: false });
const fail = (message: string): ToolOutcome => ({ content: message, isError: true });

const idHint = "must be an id returned by a read tool";
const optId = z.string().optional().refine((v) => v === undefined || uuid.safeParse(v).success, `id ${idHint}`);

export async function runAssistant(opts: {
  llm: LlmClient;
  repo: AssistantRepo;
  model: string;
  system: string;
  messages: ChatMessage[];
  currency?: string;
  maxSteps?: number;
}): Promise<AssistantResult> {
  const { llm, repo, model, system } = opts;
  const proposals: ProposalCard[] = [];
  const convo: Record<string, unknown>[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));

  async function handle(name: string, input: unknown): Promise<ToolOutcome> {
    try {
      switch (name) {
        case "search_clients": {
          const a = readInputSchemas.search_clients.safeParse(input);
          if (!a.success) return fail(firstError(a.error));
          return ok({ clients: await repo.searchClients(a.data) });
        }
        case "list_projects": {
          const a = readInputSchemas.list_projects.extend({ client_id: optId }).safeParse(input);
          if (!a.success) return fail(firstError(a.error));
          return ok({ projects: await repo.listProjects(a.data) });
        }
        case "list_tasks": {
          const a = readInputSchemas.list_tasks.extend({ project_id: optId }).safeParse(input);
          if (!a.success) return fail(firstError(a.error));
          return ok({ tasks: await repo.listTasks(a.data) });
        }
        case "list_invoices": {
          const a = readInputSchemas.list_invoices.extend({ client_id: optId }).safeParse(input);
          if (!a.success) return fail(firstError(a.error));
          return ok({ invoices: await repo.listInvoices(a.data) });
        }
        case "propose_create_client": {
          const raw = proposeInputs.propose_create_client.safeParse(input);
          if (!raw.success) return fail(firstError(raw.error));
          const p = clientSchema.safeParse(raw.data);
          if (!p.success) return fail(firstError(p.error));
          const extra = [p.data.company, p.data.email].filter(Boolean).join(", ");
          return await propose("create_client", `Add client "${p.data.name}"${extra ? ` (${extra})` : ""}`, p.data);
        }
        case "propose_add_client_note": {
          const raw = proposeInputs.propose_add_client_note.safeParse(input);
          if (!raw.success) return fail(firstError(raw.error));
          const p = noteSchema.extend({ client_id: uuid }).safeParse(raw.data);
          if (!p.success) return fail(`${firstError(p.error)} (client_id ${idHint})`);
          const client = await repo.findClient(p.data.client_id);
          if (!client) return fail("No client with that id exists in this workspace.");
          const preview = p.data.body.length > 80 ? `${p.data.body.slice(0, 80)}…` : p.data.body;
          return await propose("add_client_note", `Add a note to ${client.name}: "${preview}"`, p.data);
        }
        case "propose_create_task": {
          const raw = proposeInputs.propose_create_task.safeParse(input);
          if (!raw.success) return fail(firstError(raw.error));
          const p = taskSchema.extend({ project_id: uuid }).safeParse(raw.data);
          if (!p.success) return fail(`${firstError(p.error)} (project_id ${idHint})`);
          const project = await repo.findProject(p.data.project_id);
          if (!project) return fail("No project with that id exists in this workspace.");
          return await propose("create_task", `Add task "${p.data.title}" to ${project.name}${p.data.due_date ? ` (due ${p.data.due_date})` : ""}`, p.data);
        }
        case "propose_create_invoice": {
          const raw = proposeInputs.propose_create_invoice.safeParse(input);
          if (!raw.success) return fail(firstError(raw.error));
          const p = invoiceSchema.safeParse({
            client_id: raw.data.client_id,
            due_date: raw.data.due_date,
            notes: raw.data.notes,
            items: raw.data.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unit_price })),
          });
          if (!p.success) return fail(`${firstError(p.error)} (client_id ${idHint})`);
          const client = await repo.findClient(p.data.client_id);
          if (!client) return fail("No client with that id exists in this workspace.");
          const total = invoiceTotalCents(p.data.items.map((i) => ({ quantity: i.quantity, unit_price_cents: i.unitPrice })));
          const payload = {
            client_id: p.data.client_id,
            due_date: p.data.due_date,
            notes: p.data.notes,
            items: p.data.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price_cents: i.unitPrice })),
          };
          const n = payload.items.length;
          return await propose("create_invoice", `Draft invoice for ${client.name}: ${n} line${n === 1 ? "" : "s"}, total ${formatMoney(total, opts.currency ?? "USD")}${p.data.due_date ? `, due ${p.data.due_date}` : ""}`, payload);
        }
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Tool failed");
    }
  }

  async function propose(kind: ProposalKind, summary: string, payload: unknown): Promise<ToolOutcome> {
    // Guard: whatever we store must pass the same check that runs when the user confirms.
    const check = payloadSchemas[kind].safeParse(payload);
    if (!check.success) return fail(firstError(check.error));
    const { id } = await repo.saveProposal({ kind, summary, payload });
    proposals.push({ id, kind, summary });
    return ok({ status: "pending_user_confirmation", summary, note: "Not saved yet. The user must confirm it on the card." });
  }

  const steps = opts.maxSteps ?? MAX_STEPS;
  for (let step = 0; step < steps; step++) {
    const res = await llm.messages.create({ model, max_tokens: 1024, system, tools: TOOLS, messages: convo });
    convo.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) {
      const text = res.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      return { reply: text || FALLBACK, proposals };
    }

    const results = [];
    for (const u of uses) {
      const out = await handle(u.name, u.input);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    }
    convo.push({ role: "user", content: results });
  }
  return { reply: proposals.length ? "I've prepared the items below. Please review them." : FALLBACK, proposals };
}
