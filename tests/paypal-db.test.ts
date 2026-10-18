// Runs migrations 0001 + 0002 in an in-process Postgres and checks the payment rules.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let A = "";
let B = "";
let wsA = "";

const sys = (sql: string, params: unknown[] = []) => db.query<Record<string, any>>(sql, params);
async function as(role: "anon" | "authenticated" | "service_role", user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try {
    return await db.query<Record<string, any>>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function fails(role: "anon" | "authenticated" | "service_role", user: string | null, sql: string, params: unknown[] = []) {
  try {
    await as(role, user, sql, params);
  } catch (e) {
    return String((e as Error).message);
  }
  return null;
}

/** Makes an invoice in workspace A, sent, with total $125.00 (2 x 50.00 + 1 x 25.00). Returns [id, token]. */
async function makeInvoice(status = "sent"): Promise<[string, string]> {
  const client = (await sys(`select id from clients where workspace_id = $1 limit 1`, [wsA])).rows[0].id;
  const inv = (await as("authenticated", A, `insert into invoices (workspace_id, client_id, number, status) values ($1, $2, 0, $3) returning id, public_token`, [wsA, client, status])).rows[0];
  await as("authenticated", A, `insert into invoice_items (workspace_id, invoice_id, description, quantity, unit_price_cents) values ($1,$2,'Design',2,5000),($1,$2,'Hosting',1,2500)`, [wsA, inv.id]);
  return [inv.id, inv.public_token];
}
const pay = (role: "anon" | "authenticated" | "service_role", token: string, order: string, cents = 12500, cur = "USD") =>
  as(role, null, `select record_paypal_payment($1, $2, 'CAP', $3, $4) as r`, [token, order, cents, cur]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(__dirname, "../supabase/migrations/0001_init.sql"), "utf8"));
  await db.exec(`grant usage on schema public to service_role;`);
  await db.exec(readFileSync(path.join(__dirname, "../supabase/migrations/0002_paypal.sql"), "utf8"));

  A = (await sys(`insert into auth.users (raw_user_meta_data) values ('{"workspace_name":"Alpha"}') returning id`)).rows[0].id;
  B = (await sys(`insert into auth.users (raw_user_meta_data) values ('{"workspace_name":"Beta"}') returning id`)).rows[0].id;
  wsA = (await sys(`select workspace_id from workspace_members where user_id = $1`, [A])).rows[0].workspace_id;
  await as("authenticated", A, `insert into clients (workspace_id, name) values ($1, 'Acme')`, [wsA]);
});
afterAll(async () => { await db.close(); });

describe("record_paypal_payment", () => {
  it("marks a sent invoice paid when the amount matches, and records the payment", async () => {
    const [id, token] = await makeInvoice();
    expect((await pay("service_role", token, "ORD-1")).rows[0].r).toBe("paid");
    const inv = (await sys(`select status, paid_at from invoices where id = $1`, [id])).rows[0];
    expect(inv.status).toBe("paid");
    expect(inv.paid_at).not.toBeNull();
    expect((await sys(`select amount_cents, currency, provider_capture_id from invoice_payments where invoice_id = $1`, [id])).rows).toEqual([{ amount_cents: 12500, currency: "USD", provider_capture_id: "CAP" }]);
  });

  it("is safe to run twice for the same order", async () => {
    const [id, token] = await makeInvoice();
    expect((await pay("service_role", token, "ORD-2")).rows[0].r).toBe("paid");
    expect((await pay("service_role", token, "ORD-2")).rows[0].r).toBe("already_recorded");
    expect((await sys(`select count(*)::int as n from invoice_payments where invoice_id = $1`, [id])).rows[0].n).toBe(1);
  });

  it("refuses a wrong amount or currency and changes nothing", async () => {
    const [id, token] = await makeInvoice();
    expect((await pay("service_role", token, "ORD-3", 100)).rows[0].r).toBe("amount_mismatch");
    expect((await pay("service_role", token, "ORD-3", 12500, "EUR")).rows[0].r).toBe("amount_mismatch");
    expect((await sys(`select status from invoices where id = $1`, [id])).rows[0].status).toBe("sent");
    expect((await sys(`select count(*)::int as n from invoice_payments where invoice_id = $1`, [id])).rows[0].n).toBe(0);
  });

  it("returns not_found for an unknown token", async () => {
    expect((await pay("service_role", "00000000-0000-4000-8000-000000000000", "ORD-4")).rows[0].r).toBe("not_found");
  });

  it("keeps the record but leaves the status alone when the invoice isn't open", async () => {
    const [id, token] = await makeInvoice("void");
    expect((await pay("service_role", token, "ORD-5")).rows[0].r).toBe("recorded_invoice_not_open");
    expect((await sys(`select status from invoices where id = $1`, [id])).rows[0].status).toBe("void");
    expect((await sys(`select count(*)::int as n from invoice_payments where invoice_id = $1`, [id])).rows[0].n).toBe(1);
  });

  it("can't be called by visitors or signed-in users, only by the server", async () => {
    const [, token] = await makeInvoice();
    for (const role of ["anon", "authenticated"] as const) {
      expect(await fails(role, A, `select record_paypal_payment($1, 'ORD-6', 'C', 12500, 'USD')`, [token]), role).toMatch(/permission denied/);
    }
  });
});

describe("payment data access", () => {
  it("members read their own payments only; nobody can write them directly", async () => {
    const [id, token] = await makeInvoice();
    await pay("service_role", token, "ORD-7");
    expect((await as("authenticated", A, `select count(*)::int as n from invoice_payments where invoice_id = $1`, [id])).rows[0].n).toBe(1);
    expect((await as("authenticated", B, `select count(*)::int as n from invoice_payments`)).rows[0].n).toBe(0);
    expect(await fails("anon", null, `select * from invoice_payments`)).toMatch(/permission denied/);
    expect(await fails("authenticated", A, `insert into invoice_payments (workspace_id, invoice_id, provider, provider_order_id, amount_cents, currency) values ($1,$2,'paypal','FAKE',1,'USD')`, [wsA, id])).toMatch(/permission denied/);
    expect(await fails("authenticated", A, `update invoice_payments set amount_cents = 1`)).toMatch(/permission denied/);
    expect(await fails("authenticated", A, `delete from invoice_payments`)).toMatch(/permission denied/);
  });

  it("members can't switch PayPal on for themselves", async () => {
    expect(await fails("authenticated", A, `update workspaces set paypal_enabled = true where id = $1`, [wsA])).toMatch(/permission denied/);
  });
});

describe("public invoice and PayPal flag", () => {
  it("reports paypal_enabled and still hides drafts", async () => {
    const [, sentToken] = await makeInvoice("sent");
    const [, draftToken] = await makeInvoice("draft");
    let r = (await as("anon", null, `select get_public_invoice($1) as inv`, [sentToken])).rows[0].inv;
    expect(r.paypal_enabled).toBe(false);
    await sys(`update workspaces set paypal_enabled = true where id = $1`, [wsA]);
    r = (await as("anon", null, `select get_public_invoice($1) as inv`, [sentToken])).rows[0].inv;
    expect(r.paypal_enabled).toBe(true);
    expect(r.items).toHaveLength(2);
    expect((await as("anon", null, `select get_public_invoice($1) as inv`, [draftToken])).rows[0].inv).toBeNull();
  });
});
