"""Generate a review-only, isolated BusinessHub schema. Never applies SQL."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
base = (root / 'supabase/migrations/0001_init.sql').read_text()
start = base.index('-- Every new sign-up gets their own workspace.')
end = base.index('---------------------------------------------------------------------------\n-- CRM', start)
base = base[:start] + base[end:]
text = '\n'.join([base, (root/'supabase/migrations/0002_paypal.sql').read_text(), (root/'database/proposals/seo.sql').read_text()])
text = text.replace('public.', 'businesshub.').replace('schema public', 'schema businesshub').replace('search_path = public', 'search_path = businesshub')
text = '-- REVIEW ONLY: apply only after approval, backup and auth/redirect review.\n-- No existing Grader tables, functions or signup triggers are replaced.\nbegin;\ncreate schema businesshub;\n' + text
text += (root/'database/proposals/financial.sql').read_text()
text += (root/'database/proposals/assistant.sql').read_text()
text += (root/'database/proposals/audit-usage.sql').read_text()
text += (root/'database/proposals/subscriptions.sql').read_text()
text += '''
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
'''
(root/'database/proposals/businesshub-shared-project.sql').write_text(text)
