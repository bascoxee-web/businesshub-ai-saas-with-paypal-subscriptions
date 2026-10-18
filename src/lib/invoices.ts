import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceInput } from "./schemas";

export type CreatedInvoice = { id: string; number: number };

/**
 * Creates a draft invoice and its lines. Used by the invoice form and by confirmed AI
 * proposals, so both go through the same checks. Runs as the signed-in user: row-level
 * security and the composite foreign keys reject clients from other workspaces.
 * The database creates the invoice and lines in a single transaction.
 */
export async function createInvoice(
  supabase: SupabaseClient<any, "businesshub">,
  ws: { id: string; currency: string },
  input: InvoiceInput,
): Promise<CreatedInvoice> {
  const { data, error } = await supabase.rpc("create_draft_invoice", {
    p_workspace: ws.id, p_client: input.client_id,
    p_due: input.due_date ?? null, p_notes: input.notes ?? null,
    p_items: input.items.map(it => ({description: it.description, quantity: it.quantity, unit_price_cents: it.unitPrice})),
  });
  if (error || !data) throw new Error("Could not create the invoice. No partial invoice was saved.");
  return data as CreatedInvoice;
}
