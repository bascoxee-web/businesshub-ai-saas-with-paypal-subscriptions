"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, failTo } from "@/lib/auth";
import { projectSchema, taskSchema, projectStatus, taskStatus, firstError, uuid } from "@/lib/schemas";

export async function createProjectAction(formData: FormData) {
  const { supabase, ws } = await requireWorkspace();
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo("/app/projects", firstError(parsed.error));
  const { name, client_id, due_date } = parsed.data;
  const { data, error } = await supabase
    .from("projects")
    .insert({ workspace_id: ws.id, name, client_id: client_id ?? null, due_date: due_date ?? null })
    .select("id")
    .single();
  if (error || !data) failTo("/app/projects", "Could not create the project. Check that the client still exists.");
  revalidatePath("/app/projects");
  redirect(`/app/projects/${data.id}`);
}

export async function setProjectStatusAction(id: string, formData: FormData) {
  const { supabase } = await requireWorkspace();
  const status = projectStatus.safeParse(formData.get("status"));
  if (!uuid.safeParse(id).success || !status.success) redirect("/app/projects");
  const { error } = await supabase.from("projects").update({ status: status.data }).eq("id", id);
  if (error) failTo(`/app/projects/${id}`, "Could not update the project.");
  revalidatePath(`/app/projects/${id}`);
  redirect(`/app/projects/${id}`);
}

export async function deleteProjectAction(id: string) {
  const { supabase } = await requireWorkspace();
  if (!uuid.safeParse(id).success) redirect("/app/projects");
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) failTo(`/app/projects/${id}`, "Could not delete the project.");
  revalidatePath("/app/projects");
  redirect(`/app/projects?notice=${encodeURIComponent("Project deleted")}`);
}

export async function addTaskAction(projectId: string, formData: FormData) {
  const { supabase, ws } = await requireWorkspace();
  const back = `/app/projects/${projectId}`;
  if (!uuid.safeParse(projectId).success) redirect("/app/projects");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) failTo(back, firstError(parsed.error));
  const { error } = await supabase
    .from("tasks")
    .insert({ workspace_id: ws.id, project_id: projectId, title: parsed.data.title, due_date: parsed.data.due_date ?? null });
  if (error) failTo(back, "Could not add the task.");
  revalidatePath(back);
  redirect(back);
}

export async function moveTaskAction(projectId: string, taskId: string, status: string) {
  const { supabase } = await requireWorkspace();
  const back = `/app/projects/${projectId}`;
  const parsed = taskStatus.safeParse(status);
  if (!uuid.safeParse(taskId).success || !parsed.success) redirect(back);
  const { error } = await supabase.from("tasks").update({ status: parsed.data }).eq("id", taskId).eq("project_id", projectId);
  if (error) failTo(back, "Could not move the task.");
  revalidatePath(back);
  redirect(back);
}

export async function deleteTaskAction(projectId: string, taskId: string) {
  const { supabase } = await requireWorkspace();
  const back = `/app/projects/${projectId}`;
  if (!uuid.safeParse(taskId).success) redirect(back);
  const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("project_id", projectId);
  if (error) failTo(back, "Could not delete the task.");
  revalidatePath(back);
  redirect(back);
}
