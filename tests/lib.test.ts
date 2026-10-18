import { describe, expect, it } from "vitest";
import { dollarsToCents, formatInvoiceNumber, formatMoney, invoiceTotalCents, lineTotalCents } from "@/lib/money";
import { canTransition, isOverdue, nextActions } from "@/lib/invoice-status";
import { aiMessageLimit } from "@/lib/plans";
import { clientSchema, invoiceSchema, projectSchema, taskSchema } from "@/lib/schemas";

describe("money", () => {
  it("parses plain amounts into cents", () => {
    expect(dollarsToCents("12")).toBe(1200);
    expect(dollarsToCents("$1,250.50")).toBe(125050);
    expect(dollarsToCents("0.07")).toBe(7);
    expect(dollarsToCents(19.99)).toBe(1999);
  });
  it("rejects things that are not amounts", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "12,5.5.5", "NaN", "999999999999"]) {
      expect(dollarsToCents(bad), bad).toBeNull();
    }
  });
  it("avoids floating point drift on line totals", () => {
    expect(lineTotalCents(3, 1999)).toBe(5997);
    expect(lineTotalCents(0.1, 300)).toBe(30);
    expect(lineTotalCents(1.15, 1000)).toBe(1150);
    expect(lineTotalCents(2.5, 333)).toBe(833); // 832.5 rounds up
  });
  it("sums invoices", () => {
    expect(invoiceTotalCents([{ quantity: 2, unit_price_cents: 5000 }, { quantity: 1.5, unit_price_cents: 10000 }])).toBe(25000);
    expect(invoiceTotalCents([])).toBe(0);
  });
  it("formats", () => {
    expect(formatMoney(125050)).toBe("$1,250.50");
    expect(formatInvoiceNumber(7)).toBe("INV-0007");
  });
});

describe("invoice status", () => {
  it("allows the intended moves only", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "paid")).toBe(true);
    expect(canTransition("draft", "paid")).toBe(false);
    expect(canTransition("void", "paid")).toBe(false);
    expect(canTransition("paid", "void")).toBe(false);
    expect(nextActions("sent")).toEqual(["paid", "void"]);
  });
  it("flags only sent, unpaid, past-due invoices as overdue", () => {
    expect(isOverdue("sent", "2026-01-01", "2026-01-02")).toBe(true);
    expect(isOverdue("sent", "2026-01-02", "2026-01-02")).toBe(false);
    expect(isOverdue("paid", "2026-01-01", "2026-01-02")).toBe(false);
    expect(isOverdue("draft", "2026-01-01", "2026-01-02")).toBe(false);
    expect(isOverdue("sent", null, "2026-01-02")).toBe(false);
  });
});

describe("plans", () => {
  it("falls back to the free limit for unknown plans", () => {
    expect(aiMessageLimit("nonsense")).toBe(aiMessageLimit("free"));
    expect(aiMessageLimit("growth")).toBeGreaterThan(aiMessageLimit("starter"));
  });
});

describe("schemas", () => {
  it("cleans client input", () => {
    const r = clientSchema.parse({ name: "  Ada  ", email: "", phone: "", company: " Acme " });
    expect(r).toMatchObject({ name: "Ada", company: "Acme", status: "lead" });
    expect(r.email).toBeUndefined();
  });
  it("rejects bad client input", () => {
    expect(clientSchema.safeParse({ name: "" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "A", email: "not-an-email" }).success).toBe(false);
    expect(clientSchema.safeParse({ name: "A", status: "vip" }).success).toBe(false);
  });
  it("validates dates strictly", () => {
    expect(taskSchema.safeParse({ title: "x", due_date: "2026-02-30" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", due_date: "tomorrow" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", due_date: "2026-02-28" }).success).toBe(true);
    expect(taskSchema.parse({ title: "x", due_date: "" }).due_date).toBeUndefined();
  });
  it("accepts an empty client on a project", () => {
    expect(projectSchema.parse({ name: "Site", client_id: "" }).client_id).toBeUndefined();
    expect(projectSchema.safeParse({ name: "Site", client_id: "nope" }).success).toBe(false);
  });
  it("turns invoice prices into cents and checks lines", () => {
    const id = "0b8c7a1e-5d2f-4c3a-9e1b-2f4a6c8d0e12";
    const ok = invoiceSchema.parse({ client_id: id, items: [{ description: "Design", quantity: "2", unitPrice: "$125.50" }] });
    expect(ok.items[0]).toEqual({ description: "Design", quantity: 2, unitPrice: 12550 });
    expect(invoiceSchema.safeParse({ client_id: id, items: [] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ client_id: id, items: [{ description: "x", quantity: "0", unitPrice: "5" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ client_id: id, items: [{ description: "x", quantity: "1", unitPrice: "five" }] }).success).toBe(false);
    expect(invoiceSchema.safeParse({ client_id: "bad", items: [{ description: "x", quantity: "1", unitPrice: "5" }] }).success).toBe(false);
  });
});
