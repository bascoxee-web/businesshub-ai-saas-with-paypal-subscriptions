-- REVIEW ONLY: apply only after approval, backup and auth/redirect review.
-- No existing Grader tables, functions or signup triggers are replaced.
begin;
create schema businesshub;
-- BusinessHub AI, Phase 1 schema.
-- Every row belongs to a workspace. Row-level security lets a signed-in user see and change
-- only rows in workspaces they are a member of. Cross-workspace references are blocked by
-- composite foreign keys (workspace_id, id), which Postgres checks regardless of RLS.

---------------------------------------------------------------------------
-- Workspaces and membership
---------------------------------------------------------------------------
create table businesshub.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  plan text not null default 'free' check (plan in ('free', 'starter', 'growth', 'business')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table businesshub.workspace_members (
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on businesshub.workspace_members (user_id);

create table businesshub.invoice_counters (
  workspace_id uuid primary key references businesshub.workspaces (id) on delete cascade,
  next_number integer not null default 1
);

create function businesshub.is_member(ws uuid) returns boolean
language sql security definer stable set search_path = businesshub as $$
  select exists (
    select 1 from businesshub.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

---------------------------------------------------------------------------
-- CRM
---------------------------------------------------------------------------
create table businesshub.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text check (email is null or char_length(email) <= 200),
  phone text check (phone is null or char_length(phone) <= 50),
  company text check (company is null or char_length(company) <= 120),
  status text not null default 'lead' check (status in ('lead', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index clients_workspace_idx on businesshub.clients (workspace_id, created_at desc);

create table businesshub.client_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, client_id) references businesshub.clients (workspace_id, id) on delete cascade
);
create index client_notes_client_idx on businesshub.client_notes (client_id, created_at desc);

---------------------------------------------------------------------------
-- Projects and tasks
---------------------------------------------------------------------------
create table businesshub.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'planned' check (status in ('planned', 'active', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references businesshub.clients (workspace_id, id) on delete set null (client_id)
);
create index projects_workspace_idx on businesshub.projects (workspace_id, created_at desc);

create table businesshub.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references businesshub.projects (workspace_id, id) on delete cascade
);
create index tasks_project_idx on businesshub.tasks (project_id, created_at);

---------------------------------------------------------------------------
-- Invoicing
---------------------------------------------------------------------------
create table businesshub.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
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
  foreign key (workspace_id, client_id) references businesshub.clients (workspace_id, id) on delete restrict
);
create index invoices_workspace_idx on businesshub.invoices (workspace_id, created_at desc);

create table businesshub.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  position integer not null default 0,
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  foreign key (workspace_id, invoice_id) references businesshub.invoices (workspace_id, id) on delete cascade
);
create index invoice_items_invoice_idx on businesshub.invoice_items (invoice_id, position);

-- Invoice numbers count up per workspace. The check stops a user from burning another
-- workspace's numbers (the row-level check on insert would reject the row, but only after
-- this trigger had already bumped the counter).
create function businesshub.assign_invoice_number() returns trigger
language plpgsql security definer set search_path = businesshub as $$
begin
  if auth.uid() is not null and not businesshub.is_member(new.workspace_id) then
    raise exception 'not a member of this workspace';
  end if;
  update businesshub.invoice_counters
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
  before insert on businesshub.invoices
  for each row execute function businesshub.assign_invoice_number();

-- Totals are computed in SQL so lists and the dashboard agree. SECURITY INVOKER means
-- row-level security still applies: callers only see their own workspace's invoices.
create function businesshub.invoice_totals()
returns table (invoice_id uuid, total_cents bigint)
language sql stable security invoker set search_path = businesshub as $$
  select i.id, coalesce(sum(round(ii.quantity * ii.unit_price_cents)), 0)::bigint
  from businesshub.invoices i
  left join businesshub.invoice_items ii on ii.invoice_id = i.id
  group by i.id;
$$;

-- The shareable invoice page. Anyone with the link can read ONE sent/paid invoice; drafts
-- and voided invoices are never exposed. Nothing else is reachable without signing in.
create function businesshub.get_public_invoice(p_token uuid) returns jsonb
language sql security definer stable set search_path = businesshub as $$
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
      from businesshub.invoice_items ii where ii.invoice_id = i.id
    ), '[]'::jsonb)
  )
  from businesshub.invoices i
  join businesshub.clients c on c.workspace_id = i.workspace_id and c.id = i.client_id
  join businesshub.workspaces w on w.id = i.workspace_id
  where i.public_token = p_token and i.status in ('sent', 'paid');
$$;

---------------------------------------------------------------------------
-- AI Assistant: pending actions and monthly usage
---------------------------------------------------------------------------
create table businesshub.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('create_client', 'create_invoice', 'create_task', 'add_client_note')),
  summary text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed', 'failed')),
  created_at timestamptz not null default now()
);
create index ai_proposals_workspace_idx on businesshub.ai_proposals (workspace_id, created_at desc);

create table businesshub.ai_usage (
  workspace_id uuid not null references businesshub.workspaces (id) on delete cascade,
  month date not null,
  messages integer not null default 0,
  primary key (workspace_id, month)
);

-- Atomically counts one assistant message against the plan limit. Returns false when the
-- workspace has used up its limit for the month.
create function businesshub.consume_ai_message(p_workspace uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = businesshub as $$
declare
  m date := date_trunc('month', now())::date;
  used integer;
begin
  if not businesshub.is_member(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;
  insert into businesshub.ai_usage (workspace_id, month, messages)
    values (p_workspace, m, 0)
    on conflict do nothing;
  update businesshub.ai_usage
    set messages = messages + 1
    where workspace_id = p_workspace and month = m and messages < p_limit
    returning messages into used;
  return used is not null;
end;
$$;

---------------------------------------------------------------------------
-- Row-level security
---------------------------------------------------------------------------
alter table businesshub.workspaces enable row level security;
alter table businesshub.workspace_members enable row level security;
alter table businesshub.invoice_counters enable row level security;
alter table businesshub.ai_usage enable row level security;

create policy workspaces_select on businesshub.workspaces for select to authenticated
  using (businesshub.is_member(id));
create policy workspaces_update on businesshub.workspaces for update to authenticated
  using (businesshub.is_member(id)) with check (businesshub.is_member(id));

create policy members_select on businesshub.workspace_members for select to authenticated
  using (businesshub.is_member(workspace_id));

create policy ai_usage_select on businesshub.ai_usage for select to authenticated
  using (businesshub.is_member(workspace_id));
-- invoice_counters: RLS on with no policies, so only the security-definer functions touch it.

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'client_notes', 'projects', 'tasks', 'invoices', 'invoice_items']
  loop
    execute format('alter table businesshub.%I enable row level security', t);
    execute format('create policy %I on businesshub.%I for select to authenticated using (businesshub.is_member(workspace_id))', t || '_select', t);
    execute format('create policy %I on businesshub.%I for insert to authenticated with check (businesshub.is_member(workspace_id))', t || '_insert', t);
    execute format('create policy %I on businesshub.%I for update to authenticated using (businesshub.is_member(workspace_id)) with check (businesshub.is_member(workspace_id))', t || '_update', t);
    execute format('create policy %I on businesshub.%I for delete to authenticated using (businesshub.is_member(workspace_id))', t || '_delete', t);
  end loop;
end $$;

alter table businesshub.ai_proposals enable row level security;
create policy ai_proposals_select on businesshub.ai_proposals for select to authenticated
  using (businesshub.is_member(workspace_id));
create policy ai_proposals_insert on businesshub.ai_proposals for insert to authenticated
  with check (businesshub.is_member(workspace_id) and user_id = auth.uid());
create policy ai_proposals_update on businesshub.ai_proposals for update to authenticated
  using (businesshub.is_member(workspace_id) and user_id = auth.uid())
  with check (businesshub.is_member(workspace_id) and user_id = auth.uid());

---------------------------------------------------------------------------
-- Privileges: signed-out visitors get nothing except the public invoice function.
---------------------------------------------------------------------------
revoke all on all tables in schema businesshub from anon;
revoke execute on all functions in schema businesshub from public, anon;

grant usage on schema businesshub to authenticated, anon;
grant select, insert, update, delete on all tables in schema businesshub to authenticated;
revoke insert, delete on businesshub.workspaces, businesshub.workspace_members from authenticated;
revoke insert, update, delete on businesshub.ai_usage from authenticated;
revoke insert, update, delete on businesshub.workspace_members from authenticated;
-- Members may rename their workspace but must not change their own plan (it sets AI limits).
revoke update on businesshub.workspaces from authenticated;
grant update (name, currency) on businesshub.workspaces to authenticated;

grant execute on function businesshub.is_member(uuid) to authenticated;
grant execute on function businesshub.invoice_totals() to authenticated;
grant execute on function businesshub.consume_ai_message(uuid, integer) to authenticated;
grant execute on function businesshub.get_public_invoice(uuid) to anon, authenticated;

-- PayPal payments for invoices.
-- Money arrives at the PayPal account whose API keys are in the server settings, so PayPal
-- is switched on per workspace (paypal_enabled) by whoever runs the app, never by members.

alter table businesshub.workspaces add column paypal_enabled boolean not null default false;
-- Members can still only update name and currency (column grants from 0001); paypal_enabled
-- and plan are changed from the Supabase dashboard / SQL editor.

create table businesshub.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  provider text not null check (provider in ('paypal')),
  provider_order_id text not null,
  provider_capture_id text,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique (provider, provider_order_id),
  foreign key (workspace_id, invoice_id) references businesshub.invoices (workspace_id, id) on delete cascade
);
create index invoice_payments_invoice_idx on businesshub.invoice_payments (invoice_id);

alter table businesshub.invoice_payments enable row level security;
create policy invoice_payments_select on businesshub.invoice_payments for select to authenticated
  using (businesshub.is_member(workspace_id));
-- New tables are open to the API roles by default on Supabase, so close them explicitly.
revoke all on businesshub.invoice_payments from anon, authenticated;
grant select on businesshub.invoice_payments to authenticated;

-- Called only by the server with the service-role key, after it has confirmed the payment with
-- PayPal. It re-checks the amount against the invoice itself, is safe to call twice for the same
-- order, and marks the invoice paid in the same transaction.
create function businesshub.record_paypal_payment(
  p_token uuid, p_order_id text, p_capture_id text, p_amount_cents bigint, p_currency text
) returns text
language plpgsql security definer set search_path = businesshub as $$
declare
  inv record;
  total bigint;
begin
  select id, workspace_id, status, currency into inv from businesshub.invoices where public_token = p_token for update;
  if not found then return 'not_found'; end if;

  if exists (select 1 from businesshub.invoice_payments where provider = 'paypal' and provider_order_id = p_order_id) then
    return 'already_recorded';
  end if;

  select coalesce(sum(round(quantity * unit_price_cents)), 0)::bigint into total
    from businesshub.invoice_items where invoice_id = inv.id;
  if total <> p_amount_cents or inv.currency <> upper(p_currency) then return 'amount_mismatch'; end if;

  insert into businesshub.invoice_payments (workspace_id, invoice_id, provider, provider_order_id, provider_capture_id, amount_cents, currency)
    values (inv.workspace_id, inv.id, 'paypal', p_order_id, p_capture_id, p_amount_cents, inv.currency);

  if inv.status = 'sent' then
    update businesshub.invoices set status = 'paid', paid_at = now() where id = inv.id;
    return 'paid';
  end if;
  -- The money arrived but the invoice wasn't open (already paid by hand, or voided). Keep the record.
  return 'recorded_invoice_not_open';
end;
$$;
revoke execute on function businesshub.record_paypal_payment(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function businesshub.record_paypal_payment(uuid, text, text, bigint, text) to service_role;

-- The public invoice page also learns whether a PayPal button should be shown.
create or replace function businesshub.get_public_invoice(p_token uuid) returns jsonb
language sql security definer stable set search_path = businesshub as $$
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
    'paypal_enabled', w.paypal_enabled,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', ii.description,
        'quantity', ii.quantity,
        'unit_price_cents', ii.unit_price_cents,
        'line_total_cents', round(ii.quantity * ii.unit_price_cents)::bigint
      ) order by ii.position, ii.id)
      from businesshub.invoice_items ii where ii.invoice_id = i.id
    ), '[]'::jsonb)
  )
  from businesshub.invoices i
  join businesshub.clients c on c.workspace_id = i.workspace_id and c.id = i.client_id
  join businesshub.workspaces w on w.id = i.workspace_id
  where i.public_token = p_token and i.status in ('sent', 'paid');
$$;

-- REVIEW ONLY. Depends on the BusinessHub base schema, NOT safe to run in VisionGrader yet.
-- The shared-project schema/auth inventory and namespace adaptation are still required.
-- This proposal is validated in isolated Postgres tests, not applied to a live project.
create table businesshub.seo_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references businesshub.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  url text not null check (char_length(url) <= 2048),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  created_at timestamptz not null default now(),
  unique(workspace_id, id)
);
create index seo_reports_workspace_idx on businesshub.seo_reports(workspace_id, created_at desc);
alter table businesshub.seo_reports enable row level security;
revoke all on businesshub.seo_reports from public, anon, authenticated;
grant select, insert on businesshub.seo_reports to authenticated;
create policy seo_reports_read on businesshub.seo_reports for select to authenticated using (businesshub.is_member(workspace_id));
create policy seo_reports_create on businesshub.seo_reports for insert to authenticated with check (businesshub.is_member(workspace_id));

create table businesshub.seo_finding_tasks (
  workspace_id uuid not null,
  report_id uuid not null,
  finding_id text not null,
  task_id uuid not null references businesshub.tasks(id) on delete cascade,
  primary key(report_id, finding_id),
  foreign key(workspace_id, report_id) references businesshub.seo_reports(workspace_id, id) on delete cascade
);
alter table businesshub.seo_finding_tasks enable row level security;
revoke all on businesshub.seo_finding_tasks from public, anon, authenticated;
grant select on businesshub.seo_finding_tasks to authenticated;
create policy seo_finding_tasks_read on businesshub.seo_finding_tasks for select to authenticated using (businesshub.is_member(workspace_id));

-- Atomic, idempotent conversion. Callers cannot write the link table directly.
-- Definer is necessary only to write the restricted link, so check membership AND target scope.
create function businesshub.seo_finding_to_task(report_uuid uuid, finding_key text, project_uuid uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r businesshub.seo_reports; f jsonb; task_uuid uuid;
begin
  select * into r from businesshub.seo_reports where id = report_uuid for update;
  if not found or auth.uid() is null or not businesshub.is_member(r.workspace_id) then
    raise exception 'Report unavailable';
  end if;
  if not exists(select 1 from businesshub.projects where id = project_uuid and workspace_id = r.workspace_id) then
    raise exception 'Project unavailable';
  end if;
  select task_id into task_uuid from businesshub.seo_finding_tasks where report_id = report_uuid and finding_id = finding_key;
  if found then return task_uuid; end if;
  select value into f from jsonb_array_elements(r.report->'findings') where value->>'id' = finding_key;
  if f is null or nullif(f->>'recommendation', '') is null then raise exception 'Finding unavailable'; end if;
  insert into businesshub.tasks(workspace_id, project_id, title)
    values(r.workspace_id, project_uuid, left('SEO: ' || (f->>'title'), 200)) returning id into task_uuid;
  insert into businesshub.seo_finding_tasks values(r.workspace_id, report_uuid, finding_key, task_uuid);
  return task_uuid;
end $$;
revoke all on function businesshub.seo_finding_to_task(uuid,text,uuid) from public, anon;
grant execute on function businesshub.seo_finding_to_task(uuid,text,uuid) to authenticated;
-- Included in the shared-project proposal; never apply directly to VisionGrader.
create function businesshub.create_draft_invoice(p_workspace uuid,p_client uuid,p_due date,p_notes text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv businesshub.invoices; item jsonb; pos integer:=0; cur text;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Use 1 to 50 invoice lines'; end if;
 select currency into cur from businesshub.workspaces where id=p_workspace;
 insert into businesshub.invoices(workspace_id,client_id,currency,due_date,notes,number)
 values(p_workspace,p_client,cur,p_due,p_notes,0) returning * into inv;
 for item in select value from jsonb_array_elements(p_items) loop
  if (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>100000
    or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,2)
    or (item->>'unit_price_cents')::numeric<>trunc((item->>'unit_price_cents')::numeric)
    or (item->>'unit_price_cents')::numeric>10000000000 then raise exception 'Invalid line amount'; end if;
  insert into businesshub.invoice_items(workspace_id,invoice_id,position,description,quantity,unit_price_cents)
  values(p_workspace,inv.id,pos,item->>'description',(item->>'quantity')::numeric,(item->>'unit_price_cents')::bigint);
  pos:=pos+1;
 end loop;
 return jsonb_build_object('id',inv.id,'number',inv.number);
end $$;
revoke all on function businesshub.create_draft_invoice(uuid,uuid,date,text,jsonb) from public,anon;
grant execute on function businesshub.create_draft_invoice(uuid,uuid,date,text,jsonb) to authenticated;

create function businesshub.protect_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status<>'draft' or new.sent_at is not null or new.paid_at is not null then raise exception 'Create a draft first'; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if old.status not in ('draft','void') or old.sent_at is not null then raise exception 'Issued invoices must be retained'; end if;
  return old;
 end if;
 if new.id<>old.id or new.workspace_id<>old.workspace_id or new.number<>old.number or new.public_token<>old.public_token then raise exception 'Invoice identity is immutable'; end if;
 if (old.status<>'draft' or old.sent_at is not null) and
  row(new.client_id,new.currency,new.issue_date,new.due_date,new.notes) is distinct from row(old.client_id,old.currency,old.issue_date,old.due_date,old.notes)
 then raise exception 'Issued invoice details are immutable'; end if;
 if new.status<>old.status and not (
 (old.status='draft' and new.status in ('sent','void')) or (old.status='sent' and new.status in ('paid','void')) or
 (old.status='paid' and new.status='sent') or (old.status='void' and new.status='draft' and old.sent_at is null)) then raise exception 'Invalid invoice transition'; end if;
 if old.status='paid' and new.status='sent' and exists(select 1 from businesshub.invoice_payments where invoice_id=old.id) then raise exception 'Recorded payments cannot be undone this way'; end if;
 new.sent_at:=case when old.sent_at is not null then old.sent_at when new.status='sent' then now() else null end;
 new.paid_at:=case when new.status='paid' then coalesce(old.paid_at,now()) else null end;
 return new;
end $$;
create trigger protect_invoice before insert or update or delete on businesshub.invoices for each row execute function businesshub.protect_invoice();
create function businesshub.protect_invoice_line() returns trigger language plpgsql set search_path='' as $$
declare inv businesshub.invoices; target uuid;
begin
 if tg_op='UPDATE' and row(new.invoice_id,new.workspace_id) is distinct from row(old.invoice_id,old.workspace_id) then raise exception 'Invoice line identity is immutable'; end if;
 target:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
 select * into inv from businesshub.invoices where id=target for update;
 if found and (inv.status<>'draft' or inv.sent_at is not null) then raise exception 'Only draft invoice lines can change'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger protect_invoice_line before insert or update or delete on businesshub.invoice_items for each row execute function businesshub.protect_invoice_line();
revoke all on function businesshub.protect_invoice(),businesshub.protect_invoice_line() from public,anon,authenticated;
alter table businesshub.ai_proposals add column result_href text;
create function businesshub.confirm_ai_proposal(proposal_uuid uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare p businesshub.ai_proposals; result_uuid uuid; destination text; invoice jsonb;
begin
 select * into p from businesshub.ai_proposals where id=proposal_uuid and user_id=auth.uid() for update;
 if not found then raise exception 'Suggestion unavailable'; end if;
 if p.status='confirmed' and p.result_href is not null then return p.result_href; end if;
 if p.status<>'pending' then raise exception 'Suggestion already handled'; end if;
 case p.kind
 when 'create_client' then
  insert into businesshub.clients(workspace_id,name,email,phone,company,status) values(p.workspace_id,p.payload->>'name',p.payload->>'email',p.payload->>'phone',p.payload->>'company',coalesce(p.payload->>'status','lead')) returning id into result_uuid;
  destination:='/app/clients/'||result_uuid;
 when 'create_task' then
  insert into businesshub.tasks(workspace_id,project_id,title,due_date) values(p.workspace_id,(p.payload->>'project_id')::uuid,p.payload->>'title',nullif(p.payload->>'due_date','')::date);
  destination:='/app/projects/'||(p.payload->>'project_id');
 when 'add_client_note' then
  insert into businesshub.client_notes(workspace_id,client_id,body,created_by) values(p.workspace_id,(p.payload->>'client_id')::uuid,p.payload->>'body',auth.uid());
  destination:='/app/clients/'||(p.payload->>'client_id');
 when 'create_invoice' then
  invoice:=businesshub.create_draft_invoice(p.workspace_id,(p.payload->>'client_id')::uuid,nullif(p.payload->>'due_date','')::date,p.payload->>'notes',p.payload->'items');
  destination:='/app/invoices/'||(invoice->>'id');
 else raise exception 'Unknown suggestion';
 end case;
 update businesshub.ai_proposals set status='confirmed',result_href=destination where id=p.id;
 return destination;
end $$;
revoke all on function businesshub.confirm_ai_proposal(uuid) from public,anon;
grant execute on function businesshub.confirm_ai_proposal(uuid) to authenticated;
create table businesshub.audit_usage(workspace_id uuid not null references businesshub.workspaces(id) on delete cascade,month date not null,attempts integer not null default 0,primary key(workspace_id,month));
alter table businesshub.audit_usage enable row level security;
revoke all on businesshub.audit_usage from public,anon,authenticated;
grant select on businesshub.audit_usage to authenticated;
create policy audit_usage_read on businesshub.audit_usage for select to authenticated using(businesshub.is_member(workspace_id));
create function businesshub.reserve_live_audit(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now())::date; cap integer; used integer;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 -- Provisional pilot allowances. An attempt is charged before the paid scrape, including failures.
 select case plan when 'starter' then 20 when 'growth' then 100 when 'business' then 300 else 3 end into cap from businesshub.workspaces where id=p_workspace;
 insert into businesshub.audit_usage(workspace_id,month,attempts) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.audit_usage set attempts=attempts+1 where workspace_id=p_workspace and month=m and attempts<cap returning attempts into used;
 return used is not null;
end $$;
revoke all on function businesshub.reserve_live_audit(uuid) from public,anon;
grant execute on function businesshub.reserve_live_audit(uuid) to authenticated;
-- Sandbox checkout records. No automatic production entitlement or plan updates.
create table businesshub.subscription_checkouts(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null unique references businesshub.workspaces(id) on delete cascade,
 plan text not null check(plan in ('starter','growth','business')),
 provider_id text unique,
 created_at timestamptz not null default now()
);
alter table businesshub.subscription_checkouts enable row level security;
revoke all on businesshub.subscription_checkouts from public,anon,authenticated;
grant select on businesshub.subscription_checkouts to authenticated;
create policy checkout_read on businesshub.subscription_checkouts for select to authenticated using(businesshub.is_member(workspace_id));
create function businesshub.reserve_subscription_checkout(p_workspace uuid,p_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c businesshub.subscription_checkouts;
begin
 if auth.uid() is null or not exists(select 1 from businesshub.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Owner access required'; end if;
 perform 1 from businesshub.workspaces where id=p_workspace for update;
 select * into c from businesshub.subscription_checkouts where workspace_id=p_workspace;
 if found then
  if c.plan<>p_plan then raise exception 'Existing checkout uses another plan; resolve it before changing plans'; end if;
  if c.provider_id is null and c.created_at < now()-interval '24 hours' then raise exception 'Unresolved checkout requires reconciliation'; end if;
  return to_jsonb(c);
 end if;
 insert into businesshub.subscription_checkouts(workspace_id,plan) values(p_workspace,p_plan) returning * into c;
 return to_jsonb(c);
end $$;
revoke all on function businesshub.reserve_subscription_checkout(uuid,text) from public,anon;
grant execute on function businesshub.reserve_subscription_checkout(uuid,text) to authenticated;
create function businesshub.bind_subscription_checkout(checkout_uuid uuid,subscription_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update businesshub.subscription_checkouts set provider_id=subscription_id where id=checkout_uuid and (provider_id is null or provider_id=subscription_id);
 if not found then raise exception 'Checkout binding mismatch'; end if;
end $$;
revoke all on function businesshub.bind_subscription_checkout(uuid,text) from public,anon,authenticated;
grant execute on function businesshub.bind_subscription_checkout(uuid,text) to service_role;

-- Explicit opt-in: shared Supabase signups do not automatically receive app access.
create function businesshub.initialize_workspace(workspace_name text default 'My workspace')
returns uuid language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 -- Serialize onboarding for one user to avoid duplicate workspaces on retries.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
 select workspace_id into ws from businesshub.workspace_members where user_id=auth.uid() order by created_at limit 1;
 if ws is not null then return ws; end if;
 insert into businesshub.workspaces(name) values(left(coalesce(nullif(trim(workspace_name),''),'My workspace'),80)) returning id into ws;
 insert into businesshub.workspace_members(workspace_id,user_id,role) values(ws,auth.uid(),'owner');
 insert into businesshub.invoice_counters(workspace_id) values(ws);
 return ws;
end $$;
revoke all on function businesshub.initialize_workspace(text) from public,anon;
grant execute on function businesshub.initialize_workspace(text) to authenticated;
-- Never trust the caller's requested AI limit.
create or replace function businesshub.consume_ai_message(p_workspace uuid,p_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month',now())::date; used integer; cap integer;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 select case plan when 'starter' then 300 when 'growth' then 1500 when 'business' then 6000 else 20 end into cap
 from businesshub.workspaces where id=p_workspace;
 insert into businesshub.ai_usage(workspace_id,month,messages) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.ai_usage set messages=messages+1 where workspace_id=p_workspace and month=m and messages<cap returning messages into used;
 return used is not null;
end $$;
grant usage on schema businesshub to service_role;
commit;
