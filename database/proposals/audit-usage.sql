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
