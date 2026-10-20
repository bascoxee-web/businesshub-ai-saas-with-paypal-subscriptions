// Money is stored and calculated as integer cents. Quantities have at most 2 decimals, so
// the maths is done in hundredths to avoid floating point surprises.

export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  const hundredths = Math.round(quantity * 100);
  return Math.round((hundredths * unitPriceCents) / 100);
}

export function invoiceTotalCents(items: { quantity: number; unit_price_cents: number }[]): number {
  return items.reduce((sum, it) => sum + lineTotalCents(Number(it.quantity), Number(it.unit_price_cents)), 0);
}

/** "1,250.50", "$12", "12.5" -> cents. Returns null for anything that is not a plain amount. */
export function dollarsToCents(input: string | number): number | null {
  const raw = typeof input === "number" ? input.toFixed(2) : String(input);
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return null;
  return cents;
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}
