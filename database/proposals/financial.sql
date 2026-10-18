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
