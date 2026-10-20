-- Add AI Builder as a separately verified monthly subscription. Preserve all legacy rows.
begin;
alter table businesshub.billing_subscriptions drop constraint billing_subscriptions_plan_check;
alter table businesshub.billing_subscriptions add constraint billing_subscriptions_plan_check check(plan in ('starter','growth','business','ai_builder'));

create or replace function businesshub.effective_billing_plan(p_workspace uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 select plan into result from businesshub.billing_subscriptions where workspace_id=p_workspace and environment='live'
 and plan in ('starter','growth','business') and status in ('ACTIVE','CANCELLED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours'
 order by created_at desc limit 1;
 return coalesce(result,'free');
end $$;
create function businesshub.has_builder(p_workspace uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if businesshub.effective_billing_plan(p_workspace)='free' then return false; end if;
 return exists(select 1 from businesshub.billing_subscriptions where workspace_id=p_workspace and environment='live' and plan='ai_builder'
 and status in ('ACTIVE','CANCELLED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours');
end $$;
revoke all on function businesshub.has_builder(uuid) from public,anon;
grant execute on function businesshub.has_builder(uuid) to authenticated;

create or replace function businesshub.prepare_billing_checkout(p_workspace uuid,p_plan text,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c businesshub.billing_subscriptions;
begin
 if auth.uid() is null or not exists(select 1 from businesshub.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Owner access required'; end if;
 if p_environment not in ('live','sandbox') or p_plan not in ('starter','business','ai_builder') then raise exception 'Invalid offer'; end if;
 perform 1 from businesshub.workspaces where id=p_workspace for update;
 if p_plan='ai_builder' and not exists(select 1 from businesshub.billing_subscriptions where workspace_id=p_workspace and environment=p_environment and plan in ('starter','growth','business') and status in ('ACTIVE','CANCELLED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours') then raise exception 'An active paid BusinessHub plan is required'; end if;
 select * into c from businesshub.billing_subscriptions where workspace_id=p_workspace and environment=p_environment
 and ((p_plan='ai_builder' and plan='ai_builder') or (p_plan<>'ai_builder' and plan<>'ai_builder')) order by created_at desc limit 1;
 if found and (c.status not in ('CANCELLED','EXPIRED') or c.paid_until>now() or c.risk_hold) then
  if c.plan<>p_plan or c.status in ('CANCELLED','EXPIRED') or c.risk_hold then raise exception 'Resolve the existing subscription before starting another'; end if;
  return to_jsonb(c);
 end if;
 insert into businesshub.billing_subscriptions(workspace_id,plan,environment) values(p_workspace,p_plan,p_environment) returning * into c;
 return to_jsonb(c);
end $$;

create table businesshub.builder_usage(workspace_id uuid references businesshub.workspaces(id) on delete cascade,month date not null,builds integer not null default 0 check(builds>=0),primary key(workspace_id,month));
create table businesshub.custom_tools(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references businesshub.workspaces(id),definition jsonb not null check(jsonb_typeof(definition)='object'),published boolean not null default false,created_at timestamptz not null default now(),unique(workspace_id,id));
create table businesshub.custom_tool_records(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,tool_id uuid not null,payload jsonb not null check(jsonb_typeof(payload)='object'),created_at timestamptz not null default now(),foreign key(workspace_id,tool_id) references businesshub.custom_tools(workspace_id,id));
create index custom_tools_workspace on businesshub.custom_tools(workspace_id,created_at desc);
create index custom_records_tool on businesshub.custom_tool_records(workspace_id,tool_id,created_at desc);
alter table businesshub.builder_usage enable row level security;
alter table businesshub.custom_tools enable row level security;
alter table businesshub.custom_tool_records enable row level security;
revoke all on businesshub.builder_usage,businesshub.custom_tools,businesshub.custom_tool_records from public,anon,authenticated;
grant select on businesshub.builder_usage,businesshub.custom_tools,businesshub.custom_tool_records to authenticated;
create policy builder_usage_read on businesshub.builder_usage for select to authenticated using(businesshub.is_member(workspace_id));
create policy tools_read on businesshub.custom_tools for select to authenticated using(businesshub.is_member(workspace_id));
create policy records_read on businesshub.custom_tool_records for select to authenticated using(businesshub.is_member(workspace_id));
grant all on businesshub.custom_tools to service_role;

create function businesshub.reserve_builder_request(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if not businesshub.has_builder(p_workspace) then raise exception 'Active BusinessHub plan and AI Builder add-on required'; end if;
 if not exists(select 1 from businesshub.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Owner access required'; end if;
 insert into businesshub.builder_usage(workspace_id,month) values(p_workspace,date_trunc('month',now())::date) on conflict do nothing;
 update businesshub.builder_usage set builds=builds+1 where workspace_id=p_workspace and month=date_trunc('month',now())::date and builds<10 returning builds into used;
 return used is not null;
end $$;
revoke all on function businesshub.reserve_builder_request(uuid) from public,anon;
grant execute on function businesshub.reserve_builder_request(uuid) to authenticated;

create function businesshub.publish_custom_tool(p_tool uuid) returns void
language plpgsql security definer set search_path='' as $$
declare ws uuid;
begin
 select workspace_id into ws from businesshub.custom_tools where id=p_tool;
 if ws is null or not businesshub.has_builder(ws) or not exists(select 1 from businesshub.workspace_members where workspace_id=ws and user_id=auth.uid() and role='owner') then raise exception 'Active owner access required'; end if;
 update businesshub.custom_tools set published=true where id=p_tool;
end $$;
revoke all on function businesshub.publish_custom_tool(uuid) from public,anon;
grant execute on function businesshub.publish_custom_tool(uuid) to authenticated;

create function businesshub.add_custom_tool_record(p_tool uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare t businesshub.custom_tools;
begin
 select * into t from businesshub.custom_tools where id=p_tool for update;
 if not found or not t.published or not businesshub.has_builder(t.workspace_id) then raise exception 'Active add-on and published tool required'; end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>30000 then raise exception 'Invalid record'; end if;
 if (select count(*) from businesshub.custom_tool_records where tool_id=t.id)>=1000 then raise exception 'This tool has reached its 1000-record pilot limit'; end if;
 insert into businesshub.custom_tool_records(workspace_id,tool_id,payload) values(t.workspace_id,t.id,p_payload);
end $$;
revoke all on function businesshub.add_custom_tool_record(uuid,jsonb) from public,anon;
grant execute on function businesshub.add_custom_tool_record(uuid,jsonb) to authenticated;
commit;
