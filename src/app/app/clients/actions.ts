"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, failTo } from "@/lib/auth";
import { clientSchema, noteSchema, firstError, uuid } from "@/lib/schemas";

export async function createClientAction(formData: FormData) {
  const { supabase, ws } = await requireWorkspace();
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo("/app/clients/new", firstError(parsed.error));
  const { data, error } = await supabase
    .from("clients")
    .insert({ workspace_id: ws.id, ...parsed.data })
    .select("id")
    .single();
  if (error || !data) failTo("/app/clients/new", "Could not save the client. Please try again.");
  revalidatePath("/app/clients");
  redirect(`/app/clients/${data.id}`);
}

export async function updateClientAction(id: string, formData: FormData) {
  const { supabase } = await requireWorkspace();
  const back = `/app/clients/${id}`;
  if (!uuid.safeParse(id).success) redirect("/app/clients");
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(back, firstError(parsed.error));
  const { email, phone, company, name, status } = parsed.data;
  const { error } = await supabase
    .from("clients")
    .update({ name, status, email: email ?? null, phone: phone ?? null, company: company ?? null })
    .eq("id", id);
  if (error) failTo(back, "Could not save changes. Please try again.");
  revalidatePath("/app/clients");
  redirect(`${back}?notice=${encodeURIComponent("Saved")}`);
}

export async function addNoteAction(id: string, formData: FormData) {
  const { supabase, ws, user } = await requireWorkspace();
  const back = `/app/clients/${id}`;
  if (!uuid.safeParse(id).success) redirect("/app/clients");
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(back, firstError(parsed.error));
  const { error } = await supabase
    .from("client_notes")
    .insert({ workspace_id: ws.id, client_id: id, body: parsed.data.body, created_by: user.id });
  if (error) failTo(back, "Could not save the note.");
  revalidatePath(back);
  redirect(back);
}

export async function deleteClientAction(id: string) {
  const { supabase } = await requireWorkspace();
  if (!uuid.safeParse(id).success) redirect("/app/clients");
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    // Invoices keep their client (on delete restrict), so a client with invoices can't be removed.
    const msg = error.message.includes("foreign key")
      ? "This client has invoices, so it can't be deleted. Set the status to inactive instead."
      : "Could not delete the client.";
    failTo(`/app/clients/${id}`, msg);
  }
  revalidatePath("/app/clients");
  redirect(`/app/clients?notice=${encodeURIComponent("Client deleted")}`);
}
