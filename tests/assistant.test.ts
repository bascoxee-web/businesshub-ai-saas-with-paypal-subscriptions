import { describe, expect, it } from "vitest";
import { runAssistant, type LlmClient, type LlmResponse } from "@/lib/ai/run";
import type { AssistantRepo, Row } from "@/lib/ai/repo";
import { payloadSchemas, executeProposal } from "@/lib/ai/proposals";
import { TOOLS } from "@/lib/ai/tools";

const CLIENT_ID = "0b8c7a1e-5d2f-4c3a-9e1b-2f4a6c8d0e12";
const PROJECT_ID = "1c9d8b2f-6e3a-4d4b-8f2c-3a5b7d9e1f23";

function fakeRepo() {
  const saved: { kind: string; summary: string; payload: unknown }[] = [];
  const repo: AssistantRepo = {
    async searchClients() {
      return [{ id: CLIENT_ID, name: "Maple Studio", email: "hi@maple.example", phone: null, company: null, status: "active" }] as Row[];
    },
    async listProjects() { return [{ id: PROJECT_ID, name: "Rebrand", status: "active", due_date: null, client_id: CLIENT_ID }]; },
    async listTasks() { return []; },
    async listInvoices() { return []; },
    async findClient(id) { return id === CLIENT_ID ? { id, name: "Maple Studio" } : null; },
    async findProject(id) { return id === PROJECT_ID ? { id, name: "Rebrand" } : null; },
    async saveProposal(p) { saved.push(p); return { id: `prop-${saved.length}` }; },
  };
  return { repo, saved };
}

/** A model that plays back a fixed script and records what it was sent. */
function scripted(responses: LlmResponse[]) {
  const calls: Record<string, unknown>[] = [];
  const llm: LlmClient = {
    messages: {
      async create(params) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const next = responses.shift();
        if (!next) throw new Error("script ran out");
        return next;
      },
    },
  };
  return { llm, calls };
}

const text = (t: string): LlmResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const use = (name: string, input: unknown, id = "tu_1"): LlmResponse => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });

const base = { model: "m", system: "s" };
const user = (content: string) => [{ role: "user" as const, content }];

describe("assistant loop", () => {
  it("answers directly without tools", async () => {
    const { repo } = fakeRepo();
    const { llm } = scripted([text("Hello!")]);
    const r = await runAssistant({ ...base, llm, repo, messages: user("hi") });
    expect(r).toEqual({ reply: "Hello!", proposals: [] });
  });

  it("runs a read tool and feeds the result back", async () => {
    const { repo } = fakeRepo();
    const { llm, calls } = scripted([use("search_clients", { query: "maple" }), text("You have Maple Studio.")]);
    const r = await runAssistant({ ...base, llm, repo, messages: user("who?") });
    expect(r.reply).toBe("You have Maple Studio.");
    const last = calls[1].messages as { role: string; content: any }[];
    const result = last[last.length - 1];
    expect(result.role).toBe("user");
    expect(result.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    expect(result.content[0].content).toContain("Maple Studio");
  });

  it("saves a client proposal as pending data, never as a client", async () => {
    const { repo, saved } = fakeRepo();
    const { llm } = scripted([use("propose_create_client", { name: " Ada ", email: "ada@x.io" }), text("Waiting for your OK.")]);
    const r = await runAssistant({ ...base, llm, repo, messages: user("add Ada") });
    expect(saved).toHaveLength(1);
    expect(saved[0].kind).toBe("create_client");
    expect(saved[0].payload).toMatchObject({ name: "Ada", email: "ada@x.io", status: "lead" });
    expect(r.proposals).toEqual([{ id: "prop-1", kind: "create_client", summary: expect.stringContaining("Ada") }]);
  });

  it("builds an invoice proposal in cents with a correct total", async () => {
    const { repo, saved } = fakeRepo();
    const { llm } = scripted([
      use("propose_create_invoice", {
        client_id: CLIENT_ID,
        due_date: "2026-11-01",
        items: [{ description: "Logo", quantity: 1, unit_price: 800 }, { description: "Hours", quantity: 2.5, unit_price: 120.5 }],
      }),
      text("ok"),
    ]);
    const r = await runAssistant({ ...base, llm, repo, messages: user("invoice"), currency: "USD" });
    expect(saved[0].payload).toMatchObject({
      client_id: CLIENT_ID,
      items: [{ description: "Logo", quantity: 1, unit_price_cents: 80000 }, { description: "Hours", quantity: 2.5, unit_price_cents: 12050 }],
    });
    expect(r.proposals[0].summary).toContain("$1,101.25");
    expect(r.proposals[0].summary).toContain("Maple Studio");
    // What was stored must pass the check that runs at confirmation time.
    expect(payloadSchemas.create_invoice.safeParse(saved[0].payload).success).toBe(true);
  });

  it("rejects proposals that reference ids the workspace doesn't have", async () => {
    const { repo, saved } = fakeRepo();
    const other = "2d0e9c3a-7f4b-4e5c-9a3d-4b6c8e0f2a34";
    const { llm, calls } = scripted([
      use("propose_add_client_note", { client_id: other, body: "hi" }, "a"),
      use("propose_create_task", { project_id: other, title: "x" }, "b"),
      use("propose_create_invoice", { client_id: other, items: [{ description: "x", quantity: 1, unit_price: 5 }] }, "c"),
      text("sorry"),
    ]);
    const r = await runAssistant({ ...base, llm, repo, messages: user("note") });
    expect(saved).toHaveLength(0);
    expect(r.proposals).toHaveLength(0);
    // One model turn per scripted tool call; each result sent back must be an error.
    for (const i of [1, 2, 3]) {
      const msgs = calls[i].messages as { content: any }[];
      expect(msgs[msgs.length - 1].content[0].is_error, `call ${i}`).toBe(true);
    }
  });

  it("rejects made-up ids, bad prices and empty invoices without saving", async () => {
    const { repo, saved } = fakeRepo();
    const cases = [
      { client_id: "maple-studio", items: [{ description: "x", quantity: 1, unit_price: 5 }] },
      { client_id: CLIENT_ID, items: [{ description: "x", quantity: 1, unit_price: -5 }] },
      { client_id: CLIENT_ID, items: [{ description: "x", quantity: 0, unit_price: 5 }] },
      { client_id: CLIENT_ID, items: [] },
      { client_id: CLIENT_ID, due_date: "next friday", items: [{ description: "x", quantity: 1, unit_price: 5 }] },
    ];
    for (const input of cases) {
      const { llm } = scripted([use("propose_create_invoice", input), text("done")]);
      const r = await runAssistant({ ...base, llm, repo, messages: user("go") });
      expect(r.proposals, JSON.stringify(input)).toHaveLength(0);
    }
    expect(saved).toHaveLength(0);
  });

  it("reports unknown tools and bad read filters as errors to the model", async () => {
    const { repo } = fakeRepo();
    const { llm, calls } = scripted([use("delete_everything", {}, "x"), use("list_projects", { client_id: "nope" }, "y"), text("ok")]);
    await runAssistant({ ...base, llm, repo, messages: user("go") });
    const second = (calls[1].messages as any[]).at(-1).content[0];
    const third = (calls[2].messages as any[]).at(-1).content[0];
    expect(second).toMatchObject({ tool_use_id: "x", is_error: true });
    expect(third).toMatchObject({ tool_use_id: "y", is_error: true });
  });

  it("returns every tool result when the model calls several tools at once", async () => {
    const { repo } = fakeRepo();
    const { llm, calls } = scripted([
      { content: [{ type: "tool_use", id: "a", name: "search_clients", input: {} }, { type: "tool_use", id: "b", name: "list_projects", input: {} }] },
      text("done"),
    ]);
    await runAssistant({ ...base, llm, repo, messages: user("go") });
    const results = (calls[1].messages as any[]).at(-1).content;
    expect(results.map((r: any) => r.tool_use_id)).toEqual(["a", "b"]);
  });

  it("survives a repo failure and stops after the step limit", async () => {
    const { repo } = fakeRepo();
    repo.searchClients = async () => { throw new Error("Could not search clients"); };
    const loop = Array.from({ length: 10 }, () => use("search_clients", {}));
    const { llm, calls } = scripted(loop);
    const r = await runAssistant({ ...base, llm, repo, messages: user("go"), maxSteps: 3 });
    expect(calls).toHaveLength(3);
    expect(r.reply).toMatch(/more specific/);
  });

  it("only offers the tools we defined, and none can save directly", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_clients", "propose_create_invoice"]));
    expect(names.filter((n) => !n.startsWith("propose_"))).toEqual(["search_clients", "list_projects", "list_tasks", "list_invoices"]);
    for (const t of TOOLS) expect(t.input_schema.type).toBe("object");
  });
});

describe("executeProposal", () => {
  it("refuses payloads that fail validation and unknown kinds", async () => {
    const supabase = {} as never;
    const ws = { id: "w", currency: "USD" };
    await expect(executeProposal(supabase, ws, "u", "create_client", { name: "" })).rejects.toThrow();
    await expect(executeProposal(supabase, ws, "u", "create_invoice", { client_id: "x", items: [] })).rejects.toThrow();
    await expect(executeProposal(supabase, ws, "u", "drop_tables", {})).rejects.toThrow(/Unknown/);
  });
});
