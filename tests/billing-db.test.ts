import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite;let a:string,b:string,ws:string,checkout:string;
async function as(role:string,user:string,sql:string,args:unknown[]=[]){
 await db.exec(`set role ${role};select set_config('request.jwt.claim.sub','${user}',false)`);
 try{return await db.query<any>(sql,args)}finally{await db.exec('reset role')}
}
const owner=(sql:string,args:unknown[]=[])=>as('authenticated',a,sql,args);
const server=(sql:string,args:unknown[]=[])=>as('service_role','',sql,args);
async function snapshot(status='ACTIVE',hold=false,at=new Date().toISOString(),event='event-1',paymentId='SALE-1'){
 const until=new Date(Date.now()+20*86400000).toISOString();
 return server('select businesshub.record_billing_snapshot($1,$2,$3,$4,$5,$6,$7,$8)',[checkout,'I-SUB',status,until,hold,at,JSON.stringify([{id:paymentId,status:'COMPLETED',paid_at:new Date().toISOString(),amount_cents:1500,currency:'USD'}]),event]);
}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`);
 await db.exec(readFileSync('database/proposals/businesshub-shared-project.sql','utf8'));
 await db.exec(readFileSync('database/proposals/billing-lifecycle.sql','utf8'));
 a=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
 b=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
 ws=(await owner("select businesshub.initialize_workspace('Billing test') as id")).rows[0].id;
 checkout=(await owner("select businesshub.prepare_billing_checkout($1,'starter','live') as c",[ws])).rows[0].c.id;
 await server("select businesshub.configure_billing_checkout($1,'live','P-PLAN',1500,'USD')",[checkout]);
 await server("select businesshub.bind_billing_subscription($1,'I-SUB')",[checkout]);
});
afterAll(async()=>{await db.close()});
it('isolates billing rows and denies every client payment mutation',async()=>{
 expect((await owner('select * from businesshub.billing_subscriptions')).rows).toHaveLength(1);
 expect((await as('authenticated',b,'select * from businesshub.billing_subscriptions')).rows).toHaveLength(0);
 for(const role of ['anon','authenticated']){
  await expect(as(role,a,'select * from businesshub.billing_payments')).rejects.toThrow(/permission denied/);
  await expect(as(role,a,"update businesshub.billing_subscriptions set status='ACTIVE'")).rejects.toThrow(/permission denied/);
  await expect(as(role,a,"select businesshub.bind_billing_subscription($1,'FAKE')",[checkout])).rejects.toThrow(/permission denied/);
  await expect(as(role,a,"select businesshub.record_billing_snapshot($1,'FAKE','ACTIVE',now(),false,now(),'[]',null)",[checkout])).rejects.toThrow(/permission denied/);
 }
 await expect(as('authenticated',b,"select businesshub.prepare_billing_checkout($1,'business','live')",[ws])).rejects.toThrow(/Owner/);
});
it('retries the same checkout and forbids changing terms or concurrent plans',async()=>{
 expect((await owner("select businesshub.prepare_billing_checkout($1,'starter','live') as c",[ws])).rows[0].c.id).toBe(checkout);
 await expect(owner("select businesshub.prepare_billing_checkout($1,'growth','live')",[ws])).rejects.toThrow(/existing/);
 await expect(server("select businesshub.configure_billing_checkout($1,'live','P-CHEAP',1,'USD')",[checkout])).rejects.toThrow(/immutable/);
});
it('grants only after a verified payment, deduplicates events and retains paid access on cancellation',async()=>{
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
 await snapshot();await snapshot();
 expect((await server('select * from businesshub.billing_payments')).rows).toHaveLength(1);
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('starter');
 await snapshot('CANCELLED',false,new Date().toISOString(),'cancel');
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('starter');
 await expect(owner("select businesshub.prepare_billing_checkout($1,'starter','live')",[ws])).rejects.toThrow(/existing/);
});
it('expires stale checks and paid periods even without a webhook',async()=>{
 await db.query("update businesshub.billing_subscriptions set verified_at=now()-interval '49 hours' where id=$1",[checkout]);
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
 await db.query("update businesshub.billing_subscriptions set verified_at=now(),paid_until=now()-interval '1 second' where id=$1",[checkout]);
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
});
it('ignores stale state updates and never clears refund/dispute holds',async()=>{
 await snapshot('SUSPENDED',false,new Date().toISOString(),'suspend');
 await snapshot('ACTIVE',false,new Date(Date.now()-60000).toISOString(),'old');
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
 await snapshot('ACTIVE',true,new Date().toISOString(),'refund');
 await snapshot('ACTIVE',false,new Date().toISOString(),'activate');
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
 expect((await owner('select risk_hold from businesshub.billing_subscriptions')).rows[0].risk_hold).toBe(true);
});
it('holds a refund arriving before its completed payment',async()=>{
 await server("insert into businesshub.billing_risk_transactions(provider_id,event_id) values('SALE-EARLY','refund-before-completed')");
 await db.query('update businesshub.billing_subscriptions set risk_hold=false where id=$1',[checkout]);
 await snapshot('ACTIVE',false,new Date().toISOString(),'late-completed','SALE-EARLY');
 expect((await owner('select risk_hold from businesshub.billing_subscriptions')).rows[0].risk_hold).toBe(true);
});
it('never grants live access from sandbox records' ,async()=>{
 await db.query("update businesshub.billing_subscriptions set environment='sandbox',risk_hold=false,status='ACTIVE',paid_until=now()+interval '20 days',verified_at=now() where id=$1",[checkout]);
 expect((await owner('select businesshub.effective_billing_plan($1) as p',[ws])).rows[0].p).toBe('free');
});
