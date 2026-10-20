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
