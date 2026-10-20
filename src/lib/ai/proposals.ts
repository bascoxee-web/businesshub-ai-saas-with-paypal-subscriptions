import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientSchema, noteSchema, taskSchema, dateString, uuid, invoiceQuantity } from "../schemas";
import { createInvoice } from "../invoices";

export type ProposalKind = "create_client" | "create_invoice" | "create_task" | "add_client_note";

/**
 * What gets stored in ai_proposals.payload. These are re-validated when the user confirms,
 * so nothing in the database is trusted just because the assistant wrote it.
 */
export const payloadSchemas = {
  create_client: clientSchema,
  add_client_note: noteSchema.extend({ client_id: uuid }),
  create_task: taskSchema.extend({ project_id: uuid }),
  create_invoice: z.object({
    client_id: uuid,
    due_date: dateString.optional(),
    notes: z.string().trim().max(1000).optional(),
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(200),
          quantity: z.number().refine((n) => invoiceQuantity.safeParse(n).success, "Use a positive quantity with at most two decimal places (maximum 100000)"),
          unit_price_cents: z.number().int().min(0).max(100_000_000_00),
        }),
      )
      .min(1)
      .max(50),
  }),
} as const;

export type Ws = { id: string; currency: string };

/** Performs the confirmed action as the signed-in user. Throws an Error with a readable message. */
export async function executeProposal(
  supabase: SupabaseClient<any, "businesshub">,
  ws: Ws,
  userId: string,
  kind: string,
  payload: unknown,
): Promise<string> {
  switch (kind) {
    case "create_client": {
      const p = payloadSchemas.create_client.parse(payload);
      const { data, error } = await supabase
        .from("clients")
        .insert({ workspace_id: ws.id, name: p.name, email: p.email ?? null, phone: p.phone ?? null, company: p.company ?? null, status: p.status })
        .select("id")
        .single();
      if (error || !data) throw new Error("Could not create the client");
      return `/app/clients/${data.id}`;
    }
    case "add_client_note": {
      const p = payloadSchemas.add_client_note.parse(payload);
      const { error } = await supabase
        .from("client_notes")
        .insert({ workspace_id: ws.id, client_id: p.client_id, body: p.body, created_by: userId });
      if (error) throw new Error(error.message.includes("foreign key") ? "That client no longer exists" : "Could not add the note");
      return `/app/clients/${p.client_id}`;
    }
    case "create_task": {
      const p = payloadSchemas.create_task.parse(payload);
      const { error } = await supabase
        .from("tasks")
        .insert({ workspace_id: ws.id, project_id: p.project_id, title: p.title, due_date: p.due_date ?? null });
      if (error) throw new Error(error.message.includes("foreign key") ? "That project no longer exists" : "Could not create the task");
      return `/app/projects/${p.project_id}`;
    }
    case "create_invoice": {
      const p = payloadSchemas.create_invoice.parse(payload);
      const created = await createInvoice(supabase, ws, {
        client_id: p.client_id,
        due_date: p.due_date,
        notes: p.notes || undefined,
        items: p.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unit_price_cents })),
      });
      return `/app/invoices/${created.id}`;
    }
    default:
      throw new Error("Unknown action type");
  }
}
