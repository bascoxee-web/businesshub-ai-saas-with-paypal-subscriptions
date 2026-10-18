// Minimal PayPal REST client (Orders v2 + webhook verification). The fetch function is
// injectable so tests can run without the network.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  base: string;
};

// Currencies PayPal accepts that use two decimal places (amounts are sent as "12.34").
export const PAYPAL_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "SGD", "CHF", "SEK", "NOK", "DKK", "PHP", "PLN", "MXN", "BRL", "ILS"];

export function paypalConfig(env: Record<string, string | undefined> = process.env): PayPalConfig | null {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    webhookId: env.PAYPAL_WEBHOOK_ID || undefined,
    base: env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function decimalToCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

export type Order = {
  id: string;
  status: string;
  customId?: string;
  amountCents?: number;
  currency?: string;
  captureId?: string;
  captureStatus?: string;
};

/** Pulls the fields we care about out of an Orders v2 response, whichever step it came from. */
export function parseOrder(json: any): Order {
  const unit = json?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amount = capture?.amount ?? unit?.amount;
  return {
    id: String(json?.id ?? ""),
    status: String(json?.status ?? ""),
    customId: capture?.custom_id ?? unit?.custom_id,
    amountCents: amount?.value ? (decimalToCents(String(amount.value)) ?? undefined) : undefined,
    currency: amount?.currency_code,
    captureId: capture?.id,
    captureStatus: capture?.status,
  };
}

export class PayPalClient {
  private token: { value: string; expires: number } | null = null;
  constructor(
    private cfg: PayPalConfig,
    private doFetch: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 30_000) return this.token.value;
    const res = await this.doFetch(`${this.cfg.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async call(path: string, init: { method: string; body?: unknown; requestId?: string }) {
    const token = await this.accessToken();
    const res = await this.doFetch(`${this.cfg.base}${path}`, {
      method: init.method,
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  /** Creates an order for the full invoice amount and returns the PayPal page to send the payer to. */
  async createOrder(a: {
    invoiceToken: string;
    description: string;
    amountCents: number;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
    businessName: string;
  }): Promise<{ orderId: string; approveUrl: string }> {
    const r = await this.call("/v2/checkout/orders", {
      method: "POST",
      requestId: `create-${a.invoiceToken}-${a.amountCents}-${Date.now()}`,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: a.invoiceToken,
            description: a.description.slice(0, 127),
            amount: { currency_code: a.currency, value: centsToDecimal(a.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: a.businessName.slice(0, 127),
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: a.returnUrl,
              cancel_url: a.cancelUrl,
            },
          },
        },
      },
    });
    if (!r.ok) throw new Error(`PayPal could not start the payment (${r.status})`);
    const links: { rel: string; href: string }[] = r.json.links ?? [];
    const approve = links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve");
    if (!r.json.id || !approve) throw new Error("PayPal did not return a payment link");
    return { orderId: String(r.json.id), approveUrl: approve.href };
  }

  async getOrder(orderId: string): Promise<Order> {
    const r = await this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
    if (!r.ok) throw new Error(`PayPal order lookup failed (${r.status})`);
    return parseOrder(r.json);
  }

  /** Captures an approved order. The request id makes a retry return the same capture instead of charging twice. */
  async captureOrder(orderId: string): Promise<Order> {
    const r = await this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      requestId: `capture-${orderId}`,
    });
    if (!r.ok) {
      // Already captured (e.g. webhook and return page raced): read the order instead.
      if (r.json?.details?.some?.((d: { issue?: string }) => d.issue === "ORDER_ALREADY_CAPTURED")) return this.getOrder(orderId);
      throw new Error(`PayPal could not capture the payment (${r.status})`);
    }
    return parseOrder(r.json);
  }

  async createSubscription(planId:string, checkoutId:string, origin:string) {
    const r=await this.call('/v1/billing/subscriptions',{method:'POST',requestId:checkoutId,body:{plan_id:planId,custom_id:checkoutId,application_context:{brand_name:'BusinessHub VisionAI',user_action:'SUBSCRIBE_NOW',shipping_preference:'NO_SHIPPING',return_url:`${origin}/app/billing`,cancel_url:`${origin}/app/billing`}}});
    if(!r.ok || !r.json.id)throw new Error('Could not start the subscription.');
    const details=await this.getSubscription(String(r.json.id));
    return {...details,links:details.links ?? r.json.links};
  }
  async getPlan(id:string) {
    const r=await this.call(`/v1/billing/plans/${encodeURIComponent(id)}`,{method:'GET'});
    if(!r.ok)throw new Error('Could not verify PayPal plan terms.');
    return r.json;
  }
  async subscriptionTransactions(id:string, now=new Date()) {
    const start=new Date(now.valueOf()-40*86400000);
    const query=new URLSearchParams({start_time:start.toISOString(),end_time:now.toISOString()});
    const r=await this.call(`/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?${query}`,{method:'GET'});
    if(!r.ok)throw new Error('Could not verify subscription payments.');
    return r.json;
  }
  async getSubscription(id:string) {
    const r=await this.call(`/v1/billing/subscriptions/${encodeURIComponent(id)}`,{method:'GET'});
    if(!r.ok)throw new Error('Could not verify the subscription.');
    return r.json;
  }
  async cancelSubscription(id:string){
    const r=await this.call(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{reason:'Customer requested cancellation from BusinessHub VisionAI'}});
    if(!r.ok)throw new Error('Could not cancel the subscription.');
  }

  /** Asks PayPal whether a webhook call really came from PayPal. Fails closed. */
  async verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
    if (!this.cfg.webhookId) return false;
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return false;
    }
    const h = (n: string) => headers.get(n);
    const body = {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: this.cfg.webhookId,
      webhook_event: event,
    };
    if (Object.values(body).some((v) => v === null || v === undefined)) return false;
    const r = await this.call("/v1/notifications/verify-webhook-signature", { method: "POST", body });
    return r.ok && r.json?.verification_status === "SUCCESS";
  }
}
