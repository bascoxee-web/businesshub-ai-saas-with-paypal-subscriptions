-- Incremental migration: preserves legacy subscriptions, custom tools and workspace records.
begin;
alter table businesshub.billing_subscriptions drop constraint billing_subscriptions_plan_check;
alter table businesshub.billing_subscriptions add constraint billing_subscriptions_plan_check check(plan in ('starter','growth','business','pro','agency','ai_builder'));
create or replace function businesshub.effective_billing_plan(p_workspace uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 select plan into result from businesshub.billing_subscriptions where workspace_id=p_workspace and environment='live'
 and plan in ('starter','growth','business','pro','agency') and status in ('ACTIVE','CANCELLED','SUSPENDED','EXPIRED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours'
 order by created_at desc limit 1;
 return coalesce(result,'free');
end $$;
create or replace function businesshub.has_builder(p_workspace uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if businesshub.effective_billing_plan(p_workspace)='free' then return false; end if;
 return exists(select 1 from businesshub.billing_subscriptions where workspace_id=p_workspace and environment='live' and plan='ai_builder'
 and status in ('ACTIVE','CANCELLED','SUSPENDED','EXPIRED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours');
end $$;
revoke all on function businesshub.has_builder(uuid) from public,anon;
grant execute on function businesshub.has_builder(uuid) to authenticated;

create or replace function businesshub.prepare_billing_checkout(p_workspace uuid,p_plan text,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c businesshub.billing_subscriptions;
begin
 if auth.uid() is null or not exists(select 1 from businesshub.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Owner access required'; end if;
 if p_environment not in ('live','sandbox') or p_plan not in ('starter','business','pro','agency','ai_builder') then raise exception 'Invalid offer'; end if;
 perform 1 from businesshub.workspaces where id=p_workspace for update;
 if p_plan='ai_builder' and not exists(select 1 from businesshub.billing_subscriptions where workspace_id=p_workspace and environment=p_environment and plan in ('starter','growth','business','pro','agency') and status in ('ACTIVE','CANCELLED','SUSPENDED','EXPIRED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours') then raise exception 'An active paid BusinessHub plan is required'; end if;
 select * into c from businesshub.billing_subscriptions where workspace_id=p_workspace and environment=p_environment
 and ((p_plan='ai_builder' and plan='ai_builder') or (p_plan<>'ai_builder' and plan<>'ai_builder')) order by created_at desc limit 1;
 if found and (c.status not in ('CANCELLED','EXPIRED') or c.paid_until>now() or c.risk_hold) then
  if c.plan<>p_plan or c.status in ('CANCELLED','EXPIRED') or c.risk_hold then raise exception 'Resolve the existing subscription before starting another'; end if;
  return to_jsonb(c);
 end if;
 insert into businesshub.billing_subscriptions(workspace_id,plan,environment) values(p_workspace,p_plan,p_environment) returning * into c;
 return to_jsonb(c);
end $$;

create or replace function businesshub.consume_ai_message(p_workspace uuid,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now())::date; used integer; cap integer;
begin
 cap:=case businesshub.effective_billing_plan(p_workspace) when 'pro' then 300 when 'agency' then 6000 when 'starter' then 300 when 'growth' then 1500 when 'business' then 6000 else 20 end;
 insert into businesshub.ai_usage(workspace_id,month,messages) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.ai_usage set messages=messages+1 where workspace_id=p_workspace and month=m and messages<cap returning messages into used;
 return used is not null;
end $$;
create or replace function businesshub.reserve_live_audit(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now())::date; used integer; cap integer;
begin
 cap:=case businesshub.effective_billing_plan(p_workspace) when 'pro' then 20 when 'agency' then 300 when 'starter' then 20 when 'growth' then 100 when 'business' then 300 else 3 end;
 insert into businesshub.audit_usage(workspace_id,month,attempts) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.audit_usage set attempts=attempts+1 where workspace_id=p_workspace and month=m and attempts<cap returning attempts into used;
 return used is not null;
end $$;
commit;
