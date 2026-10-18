-- PayPal payments for invoices.
-- Money arrives at the PayPal account whose API keys are in the server settings, so PayPal
-- is switched on per workspace (paypal_enabled) by whoever runs the app, never by members.

alter table public.workspaces add column paypal_enabled boolean not null default false;
-- Members can still only update name and currency (column grants from 0001); paypal_enabled
-- and plan are changed from the Supabase dashboard / SQL editor.

create table public.invoice_payments (
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
  foreign key (workspace_id, invoice_id) references public.invoices (workspace_id, id) on delete cascade
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (public.is_member(workspace_id));
-- New tables are open to the API roles by default on Supabase, so close them explicitly.
revoke all on public.invoice_payments from anon, authenticated;
grant select on public.invoice_payments to authenticated;

-- Called only by the server with the service-role key, after it has confirmed the payment with
-- PayPal. It re-checks the amount against the invoice itself, is safe to call twice for the same
-- order, and marks the invoice paid in the same transaction.
create function public.record_paypal_payment(
  p_token uuid, p_order_id text, p_capture_id text, p_amount_cents bigint, p_currency text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  inv record;
  total bigint;
begin
  select id, workspace_id, status, currency into inv from public.invoices where public_token = p_token for update;
  if not found then return 'not_found'; end if;

  if exists (select 1 from public.invoice_payments where provider = 'paypal' and provider_order_id = p_order_id) then
    return 'already_recorded';
  end if;

  select coalesce(sum(round(quantity * unit_price_cents)), 0)::bigint into total
    from public.invoice_items where invoice_id = inv.id;
  if total <> p_amount_cents or inv.currency <> upper(p_currency) then return 'amount_mismatch'; end if;

  insert into public.invoice_payments (workspace_id, invoice_id, provider, provider_order_id, provider_capture_id, amount_cents, currency)
    values (inv.workspace_id, inv.id, 'paypal', p_order_id, p_capture_id, p_amount_cents, inv.currency);

  if inv.status = 'sent' then
    update public.invoices set status = 'paid', paid_at = now() where id = inv.id;
    return 'paid';
  end if;
  -- The money arrived but the invoice wasn't open (already paid by hand, or voided). Keep the record.
  return 'recorded_invoice_not_open';
end;
$$;
revoke execute on function public.record_paypal_payment(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_paypal_payment(uuid, text, text, bigint, text) to service_role;

-- The public invoice page also learns whether a PayPal button should be shown.
create or replace function public.get_public_invoice(p_token uuid) returns jsonb
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
    'paypal_enabled', w.paypal_enabled,
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
