import { describe, expect, it } from "vitest";
import { PayPalClient, centsToDecimal, decimalToCents, parseOrder, paypalConfig, type FetchLike } from "@/lib/paypal";
import { settleOrder, type SettleDeps } from "@/lib/payments";

const TOKEN = "0b8c7a1e-5d2f-4c3a-9e1b-2f4a6c8d0e12";
const cfg = { clientId: "id", clientSecret: "secret", webhookId: "WH-1", base: "https://api-m.sandbox.paypal.com" };

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

/** Fake PayPal: answers by "METHOD path" and records every call. */
function fakeFetch(routes: Record<string, { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    const raw = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: raw && raw.startsWith("{") ? JSON.parse(raw) : raw });
    const hit = routes[`${method} ${path}`];
    if (!hit) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    return new Response(JSON.stringify(hit.json), { status: hit.status ?? 200 });
  };
  return { f, calls };
}
const tokenRoute = { "POST /v1/oauth2/token": { json: { access_token: "T", expires_in: 3600 } } };

describe("amounts", () => {
  it("converts cents and decimals both ways without float errors", () => {
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(110125)).toBe("1101.25");
    expect(decimalToCents("1101.25")).toBe(110125);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("abc")).toBeNull();
    expect(decimalToCents("1.234")).toBeNull();
  });
});

describe("config", () => {
  it("is off without keys and picks sandbox or live", () => {
    expect(paypalConfig({})).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })?.base).toContain("sandbox");
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", PAYPAL_ENV: "live" })?.base).toBe("https://api-m.paypal.com");
  });
});

describe("PayPalClient", () => {
  it("creates an order for the exact amount and returns the approval link", async () => {
    const { f, calls } = fakeFetch({
      ...tokenRoute,
      "POST /v2/checkout/orders": { json: { id: "ORD12345", links: [{ rel: "self", href: "x" }, { rel: "payer-action", href: "https://paypal.test/approve" }] } },
    });
    const r = await new PayPalClient(cfg, f).createOrder({
      invoiceToken: TOKEN, description: "Invoice INV-0001", amountCents: 110125, currency: "USD",
      returnUrl: "https://app.test/i/x/paypal/return", cancelUrl: "https://app.test/i/x", businessName: "Alpha",
    });
    expect(r).toEqual({ orderId: "ORD12345", approveUrl: "https://paypal.test/approve" });
    const create = calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
    expect(create.headers.Authorization).toBe("Bearer T");
    expect(create.body.intent).toBe("CAPTURE");
    expect(create.body.purchase_units[0]).toMatchObject({ custom_id: TOKEN, amount: { currency_code: "USD", value: "1101.25" } });
    expect(create.body.payment_source.paypal.experience_context.return_url).toBe("https://app.test/i/x/paypal/return");
  });

  it("fails clearly when PayPal rejects or returns no link", async () => {
    const bad = fakeFetch({ ...tokenRoute, "POST /v2/checkout/orders": { status: 422, json: {} } });
    await expect(new PayPalClient(cfg, bad.f).createOrder({ invoiceToken: TOKEN, description: "d", amountCents: 100, currency: "USD", returnUrl: "r", cancelUrl: "c", businessName: "b" })).rejects.toThrow(/422/);
    const nolink = fakeFetch({ ...tokenRoute, "POST /v2/checkout/orders": { json: { id: "ORD12345", links: [] } } });
    await expect(new PayPalClient(cfg, nolink.f).createOrder({ invoiceToken: TOKEN, description: "d", amountCents: 100, currency: "USD", returnUrl: "r", cancelUrl: "c", businessName: "b" })).rejects.toThrow(/link/);
  });

  it("captures with a request id so a retry can't charge twice", async () => {
    const { f, calls } = fakeFetch({
      ...tokenRoute,
      "POST /v2/checkout/orders/ORD12345/capture": {
        json: { id: "ORD12345", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", custom_id: TOKEN, amount: { value: "12.50", currency_code: "USD" } }] } }] },
      },
    });
    const o = await new PayPalClient(cfg, f).captureOrder("ORD12345");
    expect(o).toMatchObject({ status: "COMPLETED", captureId: "CAP1", captureStatus: "COMPLETED", customId: TOKEN, amountCents: 1250, currency: "USD" });
    expect(calls.find((c) => c.url.endsWith("/capture"))!.headers["PayPal-Request-Id"]).toBe("capture-ORD12345");
  });

  it("falls back to reading the order when it was already captured", async () => {
    const { f } = fakeFetch({
      ...tokenRoute,
      "POST /v2/checkout/orders/ORD12345/capture": { status: 422, json: { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } },
      "GET /v2/checkout/orders/ORD12345": { json: { id: "ORD12345", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", custom_id: TOKEN, amount: { value: "1.00", currency_code: "USD" } }] } }] } },
    });
    expect((await new PayPalClient(cfg, f).captureOrder("ORD12345")).captureId).toBe("CAP1");
  });

  it("verifies webhooks with PayPal and fails closed", async () => {
    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-transmission-id": "tid",
      "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-01-01T00:00:00Z",
    });
    const good = fakeFetch({ ...tokenRoute, "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "SUCCESS" } } });
    expect(await new PayPalClient(cfg, good.f).verifyWebhook(headers, '{"event_type":"X"}')).toBe(true);
    expect(good.calls.at(-1)!.body).toMatchObject({ webhook_id: "WH-1", transmission_id: "tid", webhook_event: { event_type: "X" } });

    const failed = fakeFetch({ ...tokenRoute, "POST /v1/notifications/verify-webhook-signature": { json: { verification_status: "FAILURE" } } });
    expect(await new PayPalClient(cfg, failed.f).verifyWebhook(headers, "{}")).toBe(false);
    expect(await new PayPalClient(cfg, good.f).verifyWebhook(new Headers(), "{}")).toBe(false); // missing headers
    expect(await new PayPalClient(cfg, good.f).verifyWebhook(headers, "not json")).toBe(false);
    expect(await new PayPalClient({ ...cfg, webhookId: undefined }, good.f).verifyWebhook(headers, "{}")).toBe(false); // no webhook id
  });

  it("parses an order that has no capture yet", () => {
    expect(parseOrder({ id: "A", status: "APPROVED", purchase_units: [{ custom_id: TOKEN, amount: { value: "5.00", currency_code: "USD" } }] }))
      .toMatchObject({ status: "APPROVED", customId: TOKEN, amountCents: 500, captureId: undefined });
  });
});

describe("settleOrder", () => {
  const completed = { id: "ORD12345", status: "COMPLETED", customId: TOKEN, amountCents: 1250, currency: "USD", captureId: "CAP1", captureStatus: "COMPLETED" };

  function deps(order: Record<string, unknown>, afterCapture?: Record<string, unknown>, recordResult = "paid") {
    const log: string[] = [];
    const recorded: any[] = [];
    const d: SettleDeps = {
      paypal: {
        async getOrder() { log.push("get"); return order as never; },
        async captureOrder() { log.push("capture"); return (afterCapture ?? completed) as never; },
      },
      async record(a) { log.push("record"); recorded.push(a); return recordResult; },
    };
    return { d, log, recorded };
  }

  it("records a completed order using PayPal's numbers, not the caller's", async () => {
    const { d, recorded, log } = deps(completed);
    expect(await settleOrder("ORD12345", d)).toEqual({ outcome: "paid", invoiceToken: TOKEN });
    expect(log).toEqual(["get", "record"]);
    expect(recorded[0]).toEqual({ token: TOKEN, orderId: "ORD12345", captureId: "CAP1", amountCents: 1250, currency: "USD" });
  });

  it("captures an approved order first", async () => {
    const { d, log } = deps({ ...completed, status: "APPROVED", captureStatus: undefined });
    expect((await settleOrder("ORD12345", d)).outcome).toBe("paid");
    expect(log).toEqual(["get", "capture", "record"]);
  });

  it("does nothing while the payer hasn't approved or the capture is still pending", async () => {
    for (const o of [{ ...completed, status: "CREATED" }, { ...completed, status: "PAYER_ACTION_REQUIRED" }, { ...completed, captureStatus: "PENDING" }]) {
      const { d, log } = deps(o);
      expect((await settleOrder("ORD12345", d)).outcome).toBe("pending");
      expect(log).not.toContain("record");
    }
  });

  it("ignores orders that aren't ours or are malformed", async () => {
    for (const o of [{ ...completed, customId: undefined }, { ...completed, customId: "not-a-uuid" }, { ...completed, amountCents: undefined }, { ...completed, currency: undefined }]) {
      const { d, log } = deps(o);
      expect((await settleOrder("ORD12345", d)).outcome).toBe("ignored");
      expect(log).not.toContain("record");
    }
    const { d, log } = deps(completed);
    expect((await settleOrder("../etc/passwd", d)).outcome).toBe("ignored");
    expect(log).toEqual([]); // never even asked PayPal
  });

  it("passes the database's verdict through and rejects unknown ones", async () => {
    for (const code of ["already_recorded", "amount_mismatch", "not_found", "recorded_invoice_not_open"]) {
      expect((await settleOrder("ORD12345", deps(completed, undefined, code).d)).outcome).toBe(code);
    }
    await expect(settleOrder("ORD12345", deps(completed, undefined, "weird").d)).rejects.toThrow(/Unexpected/);
  });
});
