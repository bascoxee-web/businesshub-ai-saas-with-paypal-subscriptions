-- Additive payment lifecycle, isolated from the existing Grader and legacy sandbox checkouts.
begin;
create table businesshub.billing_subscriptions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references businesshub.workspaces(id) on delete cascade,
 plan text not null check(plan in ('starter','growth','business')),
 environment text check(environment in ('live','sandbox')),
 provider_plan text, provider_id text unique,
 amount_cents integer check(amount_cents>0), currency text check(currency in ('USD','PHP')),
 status text not null default 'APPROVAL_PENDING' check(status in ('APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
 paid_until timestamptz, risk_hold boolean not null default false,
 verified_at timestamptz, created_at timestamptz not null default now()
);
create index billing_workspace on businesshub.billing_subscriptions(workspace_id);
create table businesshub.billing_payments (
 provider_id text primary key,
 subscription_id uuid not null references businesshub.billing_subscriptions(id),
 status text not null, paid_at timestamptz not null, amount_cents integer not null check(amount_cents>0), currency text not null
);
create index billing_payment_subscription on businesshub.billing_payments(subscription_id);
create table businesshub.billing_events (
 id text primary key, subscription_id uuid not null references businesshub.billing_subscriptions(id), processed_at timestamptz not null default now()
);
-- A signed refund/dispute may arrive before its original completed-payment notification.
create table businesshub.billing_risk_transactions(provider_id text primary key,event_id text not null,created_at timestamptz not null default now());
alter table businesshub.billing_risk_transactions enable row level security;
revoke all on businesshub.billing_risk_transactions from public,anon,authenticated;
grant all on businesshub.billing_risk_transactions to service_role;
create policy billing_risk_server on businesshub.billing_risk_transactions for all to service_role using(true) with check(true);
alter table businesshub.billing_subscriptions enable row level security;
alter table businesshub.billing_payments enable row level security;
alter table businesshub.billing_events enable row level security;
revoke all on businesshub.billing_subscriptions,businesshub.billing_payments,businesshub.billing_events from public,anon,authenticated;
grant select on businesshub.billing_subscriptions to authenticated;
create policy billing_member_read on businesshub.billing_subscriptions for select to authenticated using(businesshub.is_member(workspace_id));
grant all on businesshub.billing_subscriptions,businesshub.billing_payments,businesshub.billing_events to service_role;
create policy billing_payments_server on businesshub.billing_payments for all to service_role using(true) with check(true);
create policy billing_events_server on businesshub.billing_events for all to service_role using(true) with check(true);
create policy billing_subscriptions_server on businesshub.billing_subscriptions for all to service_role using(true) with check(true);

create function businesshub.prepare_billing_checkout(p_workspace uuid,p_plan text,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c businesshub.billing_subscriptions;
begin
 if auth.uid() is null or not exists(select 1 from businesshub.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='owner') then raise exception 'Owner access required'; end if;
 if p_environment not in ('live','sandbox') then raise exception 'Invalid environment'; end if;
 if p_plan not in ('starter','growth','business') then raise exception 'Invalid plan'; end if;
 perform 1 from businesshub.workspaces where id=p_workspace for update;
 select * into c from businesshub.billing_subscriptions where workspace_id=p_workspace and environment=p_environment order by created_at desc limit 1;
 if found and (c.status not in ('CANCELLED','EXPIRED') or c.paid_until>now() or c.risk_hold) then
  if c.plan<>p_plan or c.status in ('CANCELLED','EXPIRED') or c.risk_hold then raise exception 'Resolve the existing subscription before starting another'; end if;
  return to_jsonb(c);
 end if;
 insert into businesshub.billing_subscriptions(workspace_id,plan,environment) values(p_workspace,p_plan,p_environment) returning * into c;
 return to_jsonb(c);
end $$;
revoke all on function businesshub.prepare_billing_checkout(uuid,text,text) from public,anon;
grant execute on function businesshub.prepare_billing_checkout(uuid,text,text) to authenticated;

create function businesshub.configure_billing_checkout(p_id uuid,p_environment text,p_provider_plan text,p_amount integer,p_currency text) returns void
language plpgsql security definer set search_path='' as $$
declare c businesshub.billing_subscriptions;
begin
 select * into strict c from businesshub.billing_subscriptions where id=p_id for update;
 if c.provider_plan is not null and (c.environment<>p_environment or c.provider_plan<>p_provider_plan or c.amount_cents<>p_amount or c.currency<>p_currency) then raise exception 'Checkout terms are immutable'; end if;
 update businesshub.billing_subscriptions set environment=p_environment,provider_plan=p_provider_plan,amount_cents=p_amount,currency=p_currency where id=p_id;
end $$;
revoke all on function businesshub.configure_billing_checkout(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function businesshub.configure_billing_checkout(uuid,text,text,integer,text) to service_role;
create function businesshub.bind_billing_subscription(p_id uuid,p_provider_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update businesshub.billing_subscriptions set provider_id=p_provider_id where id=p_id and environment is not null and (provider_id is null or provider_id=p_provider_id);
 if not found then raise exception 'Subscription binding mismatch'; end if;
end $$;
revoke all on function businesshub.bind_billing_subscription(uuid,text) from public,anon,authenticated;
grant execute on function businesshub.bind_billing_subscription(uuid,text) to service_role;

-- Called only after provider identity and payments have been re-fetched with server credentials.
create function businesshub.record_billing_snapshot(p_id uuid,p_provider_id text,p_status text,p_paid_until timestamptz,p_hold boolean,p_verified_at timestamptz,p_payments jsonb,p_event_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare c businesshub.billing_subscriptions; t jsonb;
begin
 select * into strict c from businesshub.billing_subscriptions where id=p_id for update;
 if c.provider_id<>p_provider_id or c.provider_id is null then raise exception 'Subscription binding mismatch'; end if;
 if p_verified_at>now()+interval '5 minutes' or p_paid_until>now()+interval '35 days' or jsonb_array_length(p_payments)>100 then raise exception 'Invalid billing snapshot'; end if;
 -- A risk notification is sticky even if an older status request finishes later.
 if p_hold or exists(select 1 from jsonb_array_elements(p_payments) as pending(value) join businesshub.billing_risk_transactions r on r.provider_id=pending.value->>'id') then update businesshub.billing_subscriptions set risk_hold=true where id=p_id; end if;
 if p_event_id is not null and exists(select 1 from businesshub.billing_events where id=p_event_id) then return; end if;
 if c.verified_at is null or p_verified_at>=c.verified_at then
  for t in select value from jsonb_array_elements(p_payments) loop
   if (t->>'amount_cents')::integer<>c.amount_cents or t->>'currency'<>c.currency then raise exception 'Payment amount mismatch'; end if;
   if exists(select 1 from businesshub.billing_payments where provider_id=t->>'id' and subscription_id<>p_id) then raise exception 'Payment belongs to another subscription'; end if;
   insert into businesshub.billing_payments(provider_id,subscription_id,status,paid_at,amount_cents,currency)
   values(t->>'id',p_id,t->>'status',(t->>'paid_at')::timestamptz,(t->>'amount_cents')::integer,t->>'currency')
   on conflict(provider_id) do update set status=excluded.status;
  end loop;
  update businesshub.billing_subscriptions set status=p_status,paid_until=p_paid_until,verified_at=p_verified_at where id=p_id;
 end if;
 if p_event_id is not null then insert into businesshub.billing_events(id,subscription_id) values(p_event_id,p_id) on conflict do nothing; end if;
end $$;
revoke all on function businesshub.record_billing_snapshot(uuid,text,text,timestamptz,boolean,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function businesshub.record_billing_snapshot(uuid,text,text,timestamptz,boolean,timestamptz,jsonb,text) to service_role;
create function businesshub.effective_billing_plan(p_workspace uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if auth.uid() is null or not businesshub.is_member(p_workspace) then raise exception 'Workspace unavailable'; end if;
 select plan into result from businesshub.billing_subscriptions where workspace_id=p_workspace and environment='live'
 and status in ('ACTIVE','CANCELLED') and not risk_hold and paid_until>now() and verified_at>now()-interval '48 hours'
 order by created_at desc limit 1;
 return coalesce(result,'free');
end $$;
revoke all on function businesshub.effective_billing_plan(uuid) from public,anon;
grant execute on function businesshub.effective_billing_plan(uuid) to authenticated;
-- Metering reads paid entitlement at request time; expiry needs no client refresh or browser redirect.
create or replace function businesshub.consume_ai_message(p_workspace uuid,p_limit integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now())::date; used integer; cap integer;
begin
 cap:=case businesshub.effective_billing_plan(p_workspace) when 'starter' then 300 when 'growth' then 1500 when 'business' then 6000 else 20 end;
 insert into businesshub.ai_usage(workspace_id,month,messages) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.ai_usage set messages=messages+1 where workspace_id=p_workspace and month=m and messages<cap returning messages into used;
 return used is not null;
end $$;
create or replace function businesshub.reserve_live_audit(p_workspace uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now())::date; used integer; cap integer;
begin
 cap:=case businesshub.effective_billing_plan(p_workspace) when 'starter' then 20 when 'growth' then 100 when 'business' then 300 else 3 end;
 insert into businesshub.audit_usage(workspace_id,month,attempts) values(p_workspace,m,0) on conflict do nothing;
 update businesshub.audit_usage set attempts=attempts+1 where workspace_id=p_workspace and month=m and attempts<cap returning attempts into used;
 return used is not null;
end $$;
commit;
