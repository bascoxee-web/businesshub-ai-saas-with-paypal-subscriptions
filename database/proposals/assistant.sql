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
