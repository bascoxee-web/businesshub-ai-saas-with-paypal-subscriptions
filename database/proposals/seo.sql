-- REVIEW ONLY. Depends on the BusinessHub base schema, NOT safe to run in VisionGrader yet.
-- The shared-project schema/auth inventory and namespace adaptation are still required.
-- This proposal is validated in isolated Postgres tests, not applied to a live project.
create table public.seo_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  url text not null check (char_length(url) <= 2048),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  created_at timestamptz not null default now(),
  unique(workspace_id, id)
);
create index seo_reports_workspace_idx on public.seo_reports(workspace_id, created_at desc);
alter table public.seo_reports enable row level security;
revoke all on public.seo_reports from public, anon, authenticated;
grant select, insert on public.seo_reports to authenticated;
create policy seo_reports_read on public.seo_reports for select to authenticated using (public.is_member(workspace_id));
create policy seo_reports_create on public.seo_reports for insert to authenticated with check (public.is_member(workspace_id));

create table public.seo_finding_tasks (
  workspace_id uuid not null,
  report_id uuid not null,
  finding_id text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  primary key(report_id, finding_id),
  foreign key(workspace_id, report_id) references public.seo_reports(workspace_id, id) on delete cascade
);
alter table public.seo_finding_tasks enable row level security;
revoke all on public.seo_finding_tasks from public, anon, authenticated;
grant select on public.seo_finding_tasks to authenticated;
create policy seo_finding_tasks_read on public.seo_finding_tasks for select to authenticated using (public.is_member(workspace_id));

-- Atomic, idempotent conversion. Callers cannot write the link table directly.
-- Definer is necessary only to write the restricted link, so check membership AND target scope.
create function public.seo_finding_to_task(report_uuid uuid, finding_key text, project_uuid uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.seo_reports; f jsonb; task_uuid uuid;
begin
  select * into r from public.seo_reports where id = report_uuid for update;
  if not found or auth.uid() is null or not public.is_member(r.workspace_id) then
    raise exception 'Report unavailable';
  end if;
  if not exists(select 1 from public.projects where id = project_uuid and workspace_id = r.workspace_id) then
    raise exception 'Project unavailable';
  end if;
  select task_id into task_uuid from public.seo_finding_tasks where report_id = report_uuid and finding_id = finding_key;
  if found then return task_uuid; end if;
  select value into f from jsonb_array_elements(r.report->'findings') where value->>'id' = finding_key;
  if f is null or nullif(f->>'recommendation', '') is null then raise exception 'Finding unavailable'; end if;
  insert into public.tasks(workspace_id, project_id, title)
    values(r.workspace_id, project_uuid, left('SEO: ' || (f->>'title'), 200)) returning id into task_uuid;
  insert into public.seo_finding_tasks values(r.workspace_id, report_uuid, finding_key, task_uuid);
  return task_uuid;
end $$;
revoke all on function public.seo_finding_to_task(uuid,text,uuid) from public, anon;
grant execute on function public.seo_finding_to_task(uuid,text,uuid) to authenticated;
