import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite,a:string,b:string,ws:string,tool:string;
async function as(user:string,sql:string,args:unknown[]=[]){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`);try{return await db.query<any>(sql,args)}finally{await db.exec('reset role')}}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`);
 for(const f of ['businesshub-shared-project','billing-lifecycle','paid-builder','pro-agency'])await db.exec(readFileSync('database/proposals/'+f+'.sql','utf8'));
 a=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;b=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
 ws=(await as(a,"select businesshub.initialize_workspace('Owner test') as id")).rows[0].id;
 tool=(await db.query<any>("insert into businesshub.custom_tools(workspace_id,definition) values($1,'{}') returning id",[ws])).rows[0].id;
});
afterAll(async()=>{await db.close()});
it('requires base subscription, separate add-on payment and owner; no client writes',async()=>{
 await expect(as(a,'select businesshub.reserve_builder_request($1)',[ws])).rejects.toThrow(/required/);
 await expect(as(a,"insert into businesshub.custom_tools(workspace_id,definition) values($1,'{}')",[ws])).rejects.toThrow(/permission denied/);
 await db.query("insert into businesshub.billing_subscriptions(workspace_id,plan,environment,status,paid_until,verified_at) values($1,'ai_builder','live','ACTIVE',now()+interval '1 day',now())",[ws]);
 expect((await as(a,'select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(false);
 await db.query("insert into businesshub.billing_subscriptions(workspace_id,plan,environment,status,paid_until,verified_at) values($1,'starter','live','ACTIVE',now()+interval '1 day',now())",[ws]);
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(true);
 expect((await as(b,'select * from businesshub.custom_tools')).rows).toHaveLength(0);
 await expect(as(b,'select businesshub.publish_custom_tool($1)',[tool])).rejects.toThrow();
});
it('caps requests at ten and requires explicit publish before storing records',async()=>{
 for(let i=0;i<10;i++)expect((await as(a,'select businesshub.reserve_builder_request($1) as ok',[ws])).rows[0].ok).toBe(true);
 expect((await as(a,'select businesshub.reserve_builder_request($1) as ok',[ws])).rows[0].ok).toBe(false);
 await expect(as(a,"select businesshub.add_custom_tool_record($1,'{}')",[tool])).rejects.toThrow(/published/);
 await as(a,'select businesshub.publish_custom_tool($1)',[tool]);
 await as(a,"select businesshub.add_custom_tool_record($1,'{}')",[tool]);
 expect((await as(a,'select * from businesshub.custom_tool_records')).rows).toHaveLength(1);
 expect((await as(b,'select * from businesshub.custom_tool_records')).rows).toHaveLength(0);
});
it('locks mutations on base expiry or add-on refund but retains saved records',async()=>{
 await db.query("update businesshub.billing_subscriptions set paid_until=now()-interval '1 second' where plan='starter'");
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(false);
 await expect(as(a,"select businesshub.add_custom_tool_record($1,'{}')",[tool])).rejects.toThrow();
 expect((await as(a,'select * from businesshub.custom_tool_records')).rows).toHaveLength(1);
 await db.query("update businesshub.billing_subscriptions set paid_until=now()+interval '1 day' where plan='starter'");
 await db.query("update businesshub.billing_subscriptions set risk_hold=true where plan='ai_builder'");
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(false);
});
it('never unlocks from sandbox or stale verification',async()=>{
 await db.query("update businesshub.billing_subscriptions set risk_hold=false,environment='sandbox' where plan='ai_builder'");
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(false);
 await db.query("update businesshub.billing_subscriptions set environment='live',verified_at=now()-interval '49 hours' where plan='ai_builder'");
 expect((await as(a,'select businesshub.has_builder($1) as ok',[ws])).rows[0].ok).toBe(false);
});

it('supports new tiers and preserves prepaid access after suspension until expiry',async()=>{
 await db.query("delete from businesshub.billing_subscriptions");
 for(const tier of ['pro','agency']){
  const row=(await db.query<any>("insert into businesshub.billing_subscriptions(workspace_id,plan,environment,status,paid_until,verified_at) values($1,$2,'live','ACTIVE',now()+interval '1 day',now()) returning id",[ws,tier])).rows[0];
  for(const status of ['ACTIVE','CANCELLED','SUSPENDED','EXPIRED']){
   await db.query('update businesshub.billing_subscriptions set status=$1 where id=$2',[status,row.id]);
   expect((await as(a,'select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe(tier);
  }
  await db.query("update businesshub.billing_subscriptions set paid_until=now()-interval '1 second' where id=$1",[row.id]);
  expect((await as(a,'select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
  await db.query('delete from businesshub.billing_subscriptions where id=$1',[row.id]);
 }
});
