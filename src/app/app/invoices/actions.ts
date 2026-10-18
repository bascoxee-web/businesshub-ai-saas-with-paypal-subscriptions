"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, failTo } from "@/lib/auth";
import { invoiceSchema, firstError, uuid } from "@/lib/schemas";
import { createInvoice } from "@/lib/invoices";
import { canTransition, type InvoiceStatus } from "@/lib/invoice-status";

const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "void"];

export async function createInvoiceAction(formData: FormData) {
  const { supabase, ws } = await requireWorkspace();

  // The line editor posts parallel lists: one description/quantity/price per line.
  const descriptions = formData.getAll("description").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const prices = formData.getAll("unitPrice").map(String);
  const items = descriptions
    .map((description, i) => ({ description, quantity: quantities[i] ?? "", unitPrice: prices[i] ?? "" }))
    // A completely blank line is ignored; a half-filled one is reported by validation.
    .filter((l) => l.description.trim() || l.unitPrice.trim());

  const clientId = String(formData.get("client_id") ?? "");
  const back = `/app/invoices/new${clientId ? `?client=${encodeURIComponent(clientId)}` : ""}`;
  const parsed = invoiceSchema.safeParse({
    client_id: clientId,
    due_date: formData.get("due_date") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    items,
  });
  if (!parsed.success) failTo(back, firstError(parsed.error));

  let created;
  try {
    created = await createInvoice(supabase, ws, parsed.data);
  } catch (e) {
    failTo(back, e instanceof Error ? e.message : "Could not create the invoice");
  }
  revalidatePath("/app/invoices");
  redirect(`/app/invoices/${created.id}`);
}

export async function setInvoiceStatusAction(id: string, to: string) {
  const { supabase } = await requireWorkspace();
  const back = `/app/invoices/${id}`;
  if (!uuid.safeParse(id).success) redirect("/app/invoices");
  if (!STATUSES.includes(to as InvoiceStatus)) failTo(back, "Unknown status");
  const target = to as InvoiceStatus;

  const { data: inv } = await supabase.from("invoices").select("status, sent_at").eq("id", id).maybeSingle();
  if (!inv) redirect("/app/invoices");
  const from = inv.status as InvoiceStatus;
  if (!canTransition(from, target)) failTo(back, `An invoice that is ${from} can't be changed to ${target}.`);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: target };
  if (target === "sent" && !inv.sent_at) patch.sent_at = now;
  if (target === "paid") patch.paid_at = now;
  if (from === "paid") patch.paid_at = null;

  // Only update if the status is still what we just read, so two clicks can't both win.
  const { data: updated, error } = await supabase.from("invoices").update(patch).eq("id", id).eq("status", from).select("id");
  if (error) failTo(back, "Could not update the invoice.");
  if (!updated || updated.length === 0) failTo(back, "This invoice just changed. Please try again.");
  revalidatePath("/app/invoices");
  revalidatePath(back);
  redirect(back);
}

export async function deleteInvoiceAction(id: string) {
  const { supabase } = await requireWorkspace();
  const back = `/app/invoices/${id}`;
  if (!uuid.safeParse(id).success) redirect("/app/invoices");
  // Only drafts and voided invoices can be removed; sent and paid ones are a record.
  const { data, error } = await supabase.from("invoices").delete().eq("id", id).in("status", ["draft", "void"]).select("id");
  if (error) failTo(back, "Could not delete the invoice.");
  if (!data || data.length === 0) failTo(back, "Only draft or voided invoices can be deleted. Void it first.");
  revalidatePath("/app/invoices");
  redirect(`/app/invoices?notice=${encodeURIComponent("Invoice deleted")}`);
}
