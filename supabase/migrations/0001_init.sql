-- BusinessHub AI, Phase 1 schema.
-- Every row belongs to a workspace. Row-level security lets a signed-in user see and change
-- only rows in workspaces they are a member of. Cross-workspace references are blocked by
-- composite foreign keys (workspace_id, id), which Postgres checks regardless of RLS.

---------------------------------------------------------------------------
-- Workspaces and membership
---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  plan text not null default 'free' check (plan in ('free', 'starter', 'growth', 'business')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.invoice_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  next_number integer not null default 1
);

create function public.is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

-- Every new sign-up gets their own workspace.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  ws_name text;
begin
  ws_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), ''), 'My workspace'), 80);
  insert into public.workspaces (name) values (ws_name) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  insert into public.invoice_counters (workspace_id) values (ws);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

---------------------------------------------------------------------------
-- CRM
---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 50),
  company text check (company is null or char_length(company) <= 120),
  status text not null default 'lead' check (status in ('lead', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index clients_workspace_idx on public.clients (workspace_id, created_at desc);

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade
);
create index client_notes_client_idx on public.client_notes (client_id, created_at desc);

---------------------------------------------------------------------------
-- Projects and tasks
---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'planned' check (status in ('planned', 'active', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete set null (client_id)
);
create index projects_workspace_idx on public.projects (workspace_id, created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);
create index tasks_project_idx on public.tasks (project_id, created_at);

---------------------------------------------------------------------------
-- Invoicing
---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid not null,
  number integer not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  issue_date date not null default current_date,
  due_date date,
  notes text check (notes is null or char_length(notes) <= 1000),
  public_token uuid not null default gen_random_uuid() unique,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete restrict
);
create index invoices_workspace_idx on public.invoices (workspace_id, created_at desc);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  position integer not null default 0,
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  foreign key (workspace_id, invoice_id) references public.invoices (workspace_id, id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- Invoice numbers count up per workspace. The check stops a user from burning another
-- workspace's numbers (the row-level check on insert would reject the row, but only after
-- this trigger had already bumped the counter).
create function public.assign_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member(new.workspace_id) then
    raise exception 'not a member of this workspace';
  end if;
  update public.invoice_counters
    set next_number = next_number + 1
    where workspace_id = new.workspace_id
    returning next_number - 1 into new.number;
  if new.number is null then
    raise exception 'workspace has no invoice counter';
  end if;
  return new;
end;
$$;

create trigger invoices_assign_number
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();

-- Totals are computed in SQL so lists and the dashboard agree. SECURITY INVOKER means
-- row-level security still applies: callers only see their own workspace's invoices.
create function public.invoice_totals()
returns table (invoice_id uuid, total_cents bigint)
language sql stable security invoker set search_path = public as $$
  select i.id, coalesce(sum(round(ii.quantity * ii.unit_price_cents)), 0)::bigint
  from public.invoices i
  left join public.invoice_items ii on ii.invoice_id = i.id
  group by i.id;
$$;

-- The shareable invoice page. Anyone with the link can read ONE sent/paid invoice; drafts
-- and voided invoices are never exposed. Nothing else is reachable without signing in.
create function public.get_public_invoice(p_token uuid) returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'number', i.number,
    'status', i.status,
    'currency', i.currency,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'notes', i.notes,
    'business_name', w.name,
    'client_name', c.name,
    'client_company', c.company,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', ii.description,
        'quantity', ii.quantity,
        'unit_price_cents', ii.unit_price_cents,
        'line_total_cents', round(ii.quantity * ii.unit_price_cents)::bigint
      ) order by ii.position, ii.id)
      from public.invoice_items ii where ii.invoice_id = i.id
    ), '[]'::jsonb)
  )
  from public.invoices i
  join public.clients c on c.workspace_id = i.workspace_id and c.id = i.client_id
  join public.workspaces w on w.id = i.workspace_id
  where i.public_token = p_token and i.status in ('sent', 'paid');
$$;

---------------------------------------------------------------------------
-- AI Assistant: pending actions and monthly usage
---------------------------------------------------------------------------
create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('create_client', 'create_invoice', 'create_task', 'add_client_note')),
  summary text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed', 'failed')),
  created_at timestamptz not null default now()
);
create index ai_proposals_workspace_idx on public.ai_proposals (workspace_id, created_at desc);

create table public.ai_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  month date not null,
  messages integer not null default 0,
  primary key (workspace_id, month)
);

-- Atomically counts one assistant message against the plan limit. Returns false when the
-- workspace has used up its limit for the month.
create function public.consume_ai_message(p_workspace uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', now())::date;
  used integer;
begin
  if not public.is_member(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;
  insert into public.ai_usage (workspace_id, month, messages)
    values (p_workspace, m, 0)
    on conflict do nothing;
  update public.ai_usage
    set messages = messages + 1
    where workspace_id = p_workspace and month = m and messages < p_limit
    returning messages into used;
  return used is not null;
end;
$$;

---------------------------------------------------------------------------
-- Row-level security
---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.ai_usage enable row level security;

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

create policy members_select on public.workspace_members for select to authenticated
  using (public.is_member(workspace_id));

create policy ai_usage_select on public.ai_usage for select to authenticated
  using (public.is_member(workspace_id));
-- invoice_counters: RLS on with no policies, so only the security-definer functions touch it.

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'client_notes', 'projects', 'tasks', 'invoices', 'invoice_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(workspace_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_member(workspace_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_member(workspace_id))', t || '_delete', t);
  end loop;
end $$;

alter table public.ai_proposals enable row level security;
create policy ai_proposals_select on public.ai_proposals for select to authenticated
  using (public.is_member(workspace_id));
create policy ai_proposals_insert on public.ai_proposals for insert to authenticated
  with check (public.is_member(workspace_id) and user_id = auth.uid());
create policy ai_proposals_update on public.ai_proposals for update to authenticated
  using (public.is_member(workspace_id) and user_id = auth.uid())
  with check (public.is_member(workspace_id) and user_id = auth.uid());

---------------------------------------------------------------------------
-- Privileges: signed-out visitors get nothing except the public invoice function.
---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;

grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, delete on public.workspaces, public.workspace_members from authenticated;
revoke insert, update, delete on public.ai_usage from authenticated;
revoke insert, update, delete on public.workspace_members from authenticated;
-- Members may rename their workspace but must not change their own plan (it sets AI limits).
revoke update on public.workspaces from authenticated;
grant update (name, currency) on public.workspaces to authenticated;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.invoice_totals() to authenticated;
grant execute on function public.consume_ai_message(uuid, integer) to authenticated;
grant execute on function public.get_public_invoice(uuid) to anon, authenticated;
