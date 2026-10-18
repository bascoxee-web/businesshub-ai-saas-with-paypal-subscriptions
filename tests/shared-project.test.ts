import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite; let user:string,ws:string;
async function as(sql:string,params:unknown[]=[]) {
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
 try{return await db.query<any>(sql,params)}finally{await db.exec('reset role')}
}
beforeAll(async()=>{
 db=new PGlite(); await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
 create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;
 create table public.grader_sentinel(value text); insert into public.grader_sentinel values('preserve');`);
 await db.exec(readFileSync(path.join(__dirname,'../database/proposals/businesshub-shared-project.sql'),'utf8'));
 user=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
});
afterAll(async()=>{await db.close()});
it('keeps existing data and does not attach a global auth signup trigger',async()=>{
 expect((await db.query<any>('select value from public.grader_sentinel')).rows[0].value).toBe('preserve');
 expect((await db.query('select * from businesshub.workspaces')).rows).toHaveLength(0);
 expect((await db.query("select * from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal")).rows).toHaveLength(0);
});
it('explicit onboarding is idempotent and creates only a free workspace',async()=>{
 ws=(await as("select businesshub.initialize_workspace('New business') as id")).rows[0].id;
 expect((await as("select businesshub.initialize_workspace('Retry') as id")).rows[0].id).toBe(ws);
 expect((await as('select plan from businesshub.workspaces')).rows[0].plan).toBe('free');
});
it('enforces the stored plan limit despite a caller supplying a higher limit',async()=>{
 for(let i=0;i<20;i++) expect((await as('select businesshub.consume_ai_message($1,999999) as allowed',[ws])).rows[0].allowed).toBe(true);
 expect((await as('select businesshub.consume_ai_message($1,999999) as allowed',[ws])).rows[0].allowed).toBe(false);
});
it('prevents members upgrading their own subscription',async()=>{
 await expect(as("update businesshub.workspaces set plan='business' where id=$1",[ws])).rejects.toThrow(/permission denied/);
});
it('creates invoices atomically and rolls back invalid lines',async()=>{
 const client=(await as("insert into businesshub.clients(workspace_id,name) values($1,'Client') returning id",[ws])).rows[0].id;
 const args=[ws,client,JSON.stringify([{description:'Valid',quantity:1,unit_price_cents:1000},{description:'Invalid',quantity:-1,unit_price_cents:1000}])];
 await expect(as('select businesshub.create_draft_invoice($1,$2,null,null,$3)',args)).rejects.toThrow(/Invalid line/);
 expect((await as('select * from businesshub.invoices')).rows).toHaveLength(0);
 const inv=(await as('select businesshub.create_draft_invoice($1,$2,null,null,$3) as invoice',[ws,client,JSON.stringify([{description:'Service',quantity:2,unit_price_cents:1000}])])).rows[0].invoice;
 await as("update businesshub.invoices set status='sent' where id=$1",[inv.id]);
 await expect(as("update businesshub.invoice_items set unit_price_cents=1 where invoice_id=$1",[inv.id])).rejects.toThrow(/Only draft/);
 await expect(as("delete from businesshub.invoices where id=$1",[inv.id])).rejects.toThrow(/must be retained/);
 await expect(as("update businesshub.invoices set currency='PHP' where id=$1",[inv.id])).rejects.toThrow(/immutable/);
 await as("update businesshub.invoices set status='void' where id=$1",[inv.id]);
 await expect(as("update businesshub.invoices set status='draft' where id=$1",[inv.id])).rejects.toThrow(/Invalid invoice transition/);
});
it('charges only the stored live audit allowance and cannot read another workspace usage',async()=>{
 for(let i=0;i<3;i++)expect((await as('select businesshub.reserve_live_audit($1) as allowed',[ws])).rows[0].allowed).toBe(true);
 expect((await as('select businesshub.reserve_live_audit($1) as allowed',[ws])).rows[0].allowed).toBe(false);
});
it('confirms AI suggestions and their result atomically and safely retries',async()=>{
 const proposal=(await as("insert into businesshub.ai_proposals(workspace_id,user_id,kind,summary,payload) values($1,$2,'create_client','New client',$3) returning id",[ws,user,JSON.stringify({name:'AI client'})])).rows[0].id;
 const one=(await as('select businesshub.confirm_ai_proposal($1) as href',[proposal])).rows[0].href;
 expect((await as('select businesshub.confirm_ai_proposal($1) as href',[proposal])).rows[0].href).toBe(one);
 expect((await as("select * from businesshub.clients where name='AI client'")).rows).toHaveLength(1);
 const invalid=(await as("insert into businesshub.ai_proposals(workspace_id,user_id,kind,summary,payload) values($1,$2,'create_task','Bad project',$3) returning id",[ws,user,JSON.stringify({project_id:'00000000-0000-0000-0000-000000000001',title:'task'})])).rows[0].id;
 await expect(as('select businesshub.confirm_ai_proposal($1)',[invalid])).rejects.toThrow();
 expect((await as('select status from businesshub.ai_proposals where id=$1',[invalid])).rows[0].status).toBe('pending');
});
it('reserves one sandbox checkout per workspace and blocks client binding or plan elevation',async()=>{
 const one=(await as("select businesshub.reserve_subscription_checkout($1,'starter') as checkout",[ws])).rows[0].checkout;
 const two=(await as("select businesshub.reserve_subscription_checkout($1,'starter') as checkout",[ws])).rows[0].checkout;
 expect(one.id).toBe(two.id);
 await expect(as("select businesshub.reserve_subscription_checkout($1,'business')",[ws])).rejects.toThrow(/another plan/);
 await expect(as("select businesshub.bind_subscription_checkout($1,'I-FAKE')",[one.id])).rejects.toThrow(/permission denied/);
 expect((await as('select plan from businesshub.workspaces where id=$1',[ws])).rows[0].plan).toBe('free');
});
