import type { SupabaseClient } from "@supabase/supabase-js";

/** invoice id -> total in cents, computed in SQL (see invoice_totals in the migration). */
export async function invoiceTotals(supabase: SupabaseClient<any, "businesshub">): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("invoice_totals");
  if (error) throw new Error(`Could not load invoice totals: ${error.message}`);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { invoice_id: string; total_cents: number | string }[]) {
    map.set(row.invoice_id, Number(row.total_cents));
  }
  return map;
}

/** Fetches id -> name for a set of clients without relying on joins. */
export async function clientNames(supabase: SupabaseClient<any, "businesshub">, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.from("clients").select("id, name").in("id", unique);
  if (error) throw new Error(`Could not load clients: ${error.message}`);
  for (const c of data ?? []) map.set(c.id, c.name);
  return map;
}
