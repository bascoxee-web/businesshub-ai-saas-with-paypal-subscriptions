// Runs the real migration in an in-process Postgres (PGlite) and checks the things that
// must never go wrong in a multi-tenant app: one workspace reading or changing another's data.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let A = "";
let B = "";
let wsA = "";
let wsB = "";
let clientA = "";
let clientB = "";

const DRAFT = "draft";

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(
    `set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`
  );
  try {
    return await db.query<Record<string, any>>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
const sys = (sql: string, params: unknown[] = []) => db.query<Record<string, any>>(sql, params);

async function fails(user: string | null, sql: string, params: unknown[] = []) {
  try {
    await as(user, sql, params);
  } catch (e) {
    return String((e as Error).message);
  }
  return null;
}

beforeAll(async () => {
  db = new PGlite();
  // Minimal stand-in for Supabase's auth schema.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(readFileSync(path.join(__dirname, "../supabase/migrations/0001_init.sql"), "utf8"));

  A = (await sys(`insert into auth.users (raw_user_meta_data) values ('{"workspace_name":"Alpha Studio"}') returning id`)).rows[0].id;
  B = (await sys(`insert into auth.users (raw_user_meta_data) values ('{"workspace_name":"Beta Agency"}') returning id`)).rows[0].id;
  wsA = (await sys(`select workspace_id from workspace_members where user_id = $1`, [A])).rows[0].workspace_id;
  wsB = (await sys(`select workspace_id from workspace_members where user_id = $1`, [B])).rows[0].workspace_id;
  clientA = (await as(A, `insert into clients (workspace_id, name) values ($1, 'Acme') returning id`, [wsA])).rows[0].id;
  clientB = (await as(B, `insert into clients (workspace_id, name) values ($1, 'Bravo') returning id`, [wsB])).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

describe("sign-up", () => {
  it("gives each new user their own named workspace with an invoice counter", async () => {
    expect(wsA).not.toBe(wsB);
    const r = await sys(`select w.name, w.plan, c.next_number from workspaces w join invoice_counters c on c.workspace_id = w.id order by w.name`);
    expect(r.rows.map((x) => [x.name, x.plan, x.next_number])).toEqual([
      ["Alpha Studio", "free", 1],
      ["Beta Agency", "free", 1],
    ]);
  });
});

describe("tenant isolation", () => {
  it("each user sees only their own workspace and members", async () => {
    expect((await as(A, `select id from workspaces`)).rows.map((r) => r.id)).toEqual([wsA]);
    expect((await as(B, `select user_id from workspace_members`)).rows.map((r) => r.user_id)).toEqual([B]);
  });

  it("each user sees only their own clients", async () => {
    expect((await as(A, `select name from clients`)).rows.map((r) => r.name)).toEqual(["Acme"]);
    expect((await as(B, `select name from clients`)).rows.map((r) => r.name)).toEqual(["Bravo"]);
  });

  it("cannot insert rows into another workspace", async () => {
    const err = await fails(A, `insert into clients (workspace_id, name) values ($1, 'Intruder')`, [wsB]);
    expect(err).toMatch(/row-level security/i);
  });

  it("cannot update or delete another workspace's rows", async () => {
    const upd = await as(A, `update clients set name = 'Hacked' where id = $1`, [clientB]);
    expect(upd.affectedRows).toBe(0);
    const del = await as(A, `delete from clients where id = $1`, [clientB]);
    expect(del.affectedRows).toBe(0);
    expect((await sys(`select name from clients where id = $1`, [clientB])).rows[0].name).toBe("Bravo");
  });

  it("cannot link its own records to another workspace's client", async () => {
    const proj = await fails(A, `insert into projects (workspace_id, client_id, name) values ($1, $2, 'Sneaky')`, [wsA, clientB]);
    expect(proj).toMatch(/foreign key/i);
    const inv = await fails(A, `insert into invoices (workspace_id, client_id) values ($1, $2)`, [wsA, clientB]);
    expect(inv).toMatch(/foreign key/i);
    const note = await fails(A, `insert into client_notes (workspace_id, client_id, body) values ($1, $2, 'x')`, [wsA, clientB]);
    expect(note).toMatch(/foreign key/i);
  });

  it("cannot move a record into another workspace by editing workspace_id", async () => {
    const err = await fails(A, `update clients set workspace_id = $1 where id = $2`, [wsB, clientA]);
    expect(err).toMatch(/row-level security/i);
  });

  it("cannot join another workspace, create workspaces, or change its own plan", async () => {
    expect(await fails(A, `insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [wsB, A])).toMatch(/permission denied/i);
    expect(await fails(A, `insert into workspaces (name) values ('Mine too')`)).toMatch(/permission denied/i);
    expect(await fails(A, `update workspaces set plan = 'business' where id = $1`, [wsA])).toMatch(/permission denied/i);
    // renaming is allowed
    expect((await as(A, `update workspaces set name = 'Alpha Studio' where id = $1`, [wsA])).affectedRows).toBe(1);
  });

  it("signed-out visitors can read nothing", async () => {
    expect(await fails(null, `select * from clients`)).toMatch(/permission denied/i);
    expect(await fails(null, `select * from invoices`)).toMatch(/permission denied/i);
    expect(await fails(null, `select * from workspaces`)).toMatch(/permission denied/i);
  });
});

describe("invoices", () => {
  let inv1 = "";
  let tok1 = "";

  it("numbers invoices per workspace and ignores attempts to burn another workspace's numbers", async () => {
    const burn = await fails(A, `insert into invoices (workspace_id, client_id) values ($1, $2)`, [wsB, clientB]);
    expect(burn).toMatch(/not a member|row-level security/i);
    expect((await sys(`select next_number from invoice_counters where workspace_id = $1`, [wsB])).rows[0].next_number).toBe(1);

    const a1 = await as(A, `insert into invoices (workspace_id, client_id) values ($1, $2) returning id, number, public_token, status`, [wsA, clientA]);
    const a2 = await as(A, `insert into invoices (workspace_id, client_id) values ($1, $2) returning number`, [wsA, clientA]);
    const b1 = await as(B, `insert into invoices (workspace_id, client_id) values ($1, $2) returning number`, [wsB, clientB]);
    expect([a1.rows[0].number, a2.rows[0].number, b1.rows[0].number]).toEqual([1, 2, 1]);
    expect(a1.rows[0].status).toBe(DRAFT);
    inv1 = a1.rows[0].id;
    tok1 = a1.rows[0].public_token;
  });

  it("computes totals in SQL and keeps them private to the workspace", async () => {
    await as(A, `insert into invoice_items (workspace_id, invoice_id, position, description, quantity, unit_price_cents) values
      ($1, $2, 0, 'Design', 1.5, 1000), ($1, $2, 1, 'Hosting', 2, 333)`, [wsA, inv1]);
    const mine = await as(A, `select total_cents from invoice_totals() where invoice_id = $1`, [inv1]);
    expect(Number(mine.rows[0].total_cents)).toBe(2166);
    const theirs = await as(B, `select total_cents from invoice_totals() where invoice_id = $1`, [inv1]);
    expect(theirs.rows).toHaveLength(0);
  });

  it("rejects line items with bad values", async () => {
    expect(await fails(A, `insert into invoice_items (workspace_id, invoice_id, description, quantity, unit_price_cents) values ($1, $2, 'x', 0, 100)`, [wsA, inv1])).toMatch(/check constraint/i);
    expect(await fails(A, `insert into invoice_items (workspace_id, invoice_id, description, quantity, unit_price_cents) values ($1, $2, 'x', 1, -5)`, [wsA, inv1])).toMatch(/check constraint/i);
  });

  it("public link shows only sent or paid invoices", async () => {
    const get = async (token: string) => (await as(null, `select public.get_public_invoice($1) as inv`, [token])).rows[0].inv;
    expect(await get(tok1)).toBeNull(); // draft
    await as(A, `update invoices set status = 'sent', sent_at = now() where id = $1`, [inv1]);
    const sent = await get(tok1);
    expect(sent.number).toBe(1);
    expect(sent.business_name).toBe("Alpha Studio");
    expect(sent.client_name).toBe("Acme");
    expect(sent.items).toHaveLength(2);
    expect(sent.items[0].line_total_cents).toBe(1500);
    expect(sent).not.toHaveProperty("public_token");
    expect(sent).not.toHaveProperty("workspace_id");
    await as(A, `update invoices set status = 'paid', paid_at = now() where id = $1`, [inv1]);
    expect((await get(tok1)).status).toBe("paid");
    await as(A, `update invoices set status = 'void' where id = $1`, [inv1]);
    expect(await get(tok1)).toBeNull();
    expect(await get("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("AI assistant data", () => {
  it("enforces the monthly message limit atomically and only for members", async () => {
    const use = async (user: string, ws: string, limit: number) =>
      (await as(user, `select public.consume_ai_message($1, $2) as ok`, [ws, limit])).rows[0].ok;
    expect(await use(A, wsA, 2)).toBe(true);
    expect(await use(A, wsA, 2)).toBe(true);
    expect(await use(A, wsA, 2)).toBe(false);
    expect(await use(B, wsB, 2)).toBe(true); // separate workspace, separate count
    expect(await fails(A, `select public.consume_ai_message($1, 5)`, [wsB])).toMatch(/not a member/i);
    expect(await fails(A, `update ai_usage set messages = 0`)).toMatch(/permission denied/i);
  });

  it("proposals are visible to the workspace but can only be created as yourself", async () => {
    const own = await as(A, `insert into ai_proposals (workspace_id, user_id, kind, summary, payload) values ($1, $2, 'create_client', 'Add Zed', '{"name":"Zed"}') returning id`, [wsA, A]);
    expect(own.rows).toHaveLength(1);
    expect(await fails(A, `insert into ai_proposals (workspace_id, user_id, kind, summary, payload) values ($1, $2, 'create_client', 'x', '{}')`, [wsA, B])).toMatch(/row-level security/i);
    expect(await fails(A, `insert into ai_proposals (workspace_id, user_id, kind, summary, payload) values ($1, $2, 'create_client', 'x', '{}')`, [wsB, A])).toMatch(/row-level security/i);
    expect((await as(B, `select id from ai_proposals`)).rows).toHaveLength(0);
  });
});

describe("projects and tasks", () => {
  it("deleting a client keeps its projects but unlinks them, and blocks deleting a client with invoices", async () => {
    const c = (await as(A, `insert into clients (workspace_id, name) values ($1, 'Temp') returning id`, [wsA])).rows[0].id;
    const p = (await as(A, `insert into projects (workspace_id, client_id, name) values ($1, $2, 'Site') returning id`, [wsA, c])).rows[0].id;
    await as(A, `insert into tasks (workspace_id, project_id, title) values ($1, $2, 'Wireframes')`, [wsA, p]);
    await as(A, `delete from clients where id = $1`, [c]);
    const proj = await as(A, `select client_id, workspace_id from projects where id = $1`, [p]);
    expect(proj.rows[0].client_id).toBeNull();
    expect(proj.rows[0].workspace_id).toBe(wsA);
    expect(await fails(A, `delete from clients where id = $1`, [clientA])).toMatch(/foreign key/i);
    // B cannot see or add tasks on A's project
    expect((await as(B, `select id from tasks`)).rows).toHaveLength(0);
    expect(await fails(B, `insert into tasks (workspace_id, project_id, title) values ($1, $2, 'x')`, [wsB, p])).toMatch(/foreign key/i);
  });
});
