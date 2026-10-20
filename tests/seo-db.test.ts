import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
let db:PGlite; let a:string,b:string,wa:string,wb:string,pa:string,pb:string,report:string;
async function as(user:string|null,sql:string,params:unknown[]=[]) {
 await db.exec(`set role ${user?'authenticated':'anon'}; select set_config('request.jwt.claim.sub','${user??''}',false)`);
 try{return await db.query<any>(sql,params)}finally{await db.exec('reset role')}
}
beforeAll(async()=>{
 db=new PGlite(); await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;`);
 await db.exec(readFileSync(path.join(__dirname,'../supabase/migrations/0001_init.sql'),'utf8'));
 await db.exec(readFileSync(path.join(__dirname,'../database/proposals/seo.sql'),'utf8'));
 a=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
 b=(await db.query<any>('insert into auth.users default values returning id')).rows[0].id;
 wa=(await db.query<any>('select workspace_id from workspace_members where user_id=$1',[a])).rows[0].workspace_id;
 wb=(await db.query<any>('select workspace_id from workspace_members where user_id=$1',[b])).rows[0].workspace_id;
 pa=(await as(a,"insert into projects(workspace_id,name) values($1,'SEO') returning id",[wa])).rows[0].id;
 pb=(await as(b,"insert into projects(workspace_id,name) values($1,'Other') returning id",[wb])).rows[0].id;
 report=(await as(a,"insert into seo_reports(workspace_id,name,url,report) values($1,'Example','https://example.com',$2) returning id",[wa,JSON.stringify({findings:[{id:'title',title:'Missing title',recommendation:'Add an accurate title'}]})])).rows[0].id;
});
afterAll(async()=>{await db.close()});
it('isolates reports and denies anonymous access',async()=>{
 expect((await as(b,'select * from seo_reports')).rows).toHaveLength(0);
 await expect(as(null,'select * from seo_reports')).rejects.toThrow(/permission denied/);
 await expect(as(b,"insert into seo_reports(workspace_id,name,url,report) values($1,'Bad','https://example.com','{}')",[wa])).rejects.toThrow(/row-level security/);
});
it('blocks cross-workspace task conversion and unknown findings without orphan tasks',async()=>{
 await expect(as(b,'select seo_finding_to_task($1,$2,$3)',[report,'title',pb])).rejects.toThrow(/Report unavailable/);
 await expect(as(a,'select seo_finding_to_task($1,$2,$3)',[report,'title',pb])).rejects.toThrow(/Project unavailable/);
 await expect(as(a,'select seo_finding_to_task($1,$2,$3)',[report,'unknown',pa])).rejects.toThrow(/Finding unavailable/);
 expect((await db.query('select * from tasks')).rows).toHaveLength(0);
});
it('converts a finding exactly once even when confirmation is retried',async()=>{
 const one=(await as(a,'select seo_finding_to_task($1,$2,$3) as id',[report,'title',pa])).rows[0].id;
 const two=(await as(a,'select seo_finding_to_task($1,$2,$3) as id',[report,'title',pa])).rows[0].id;
 expect(one).toBe(two); expect((await db.query('select * from tasks')).rows).toHaveLength(1);
 expect((await as(b,'select * from seo_finding_tasks')).rows).toHaveLength(0);
});
it('prevents forged links and mutations to saved reports',async()=>{
 await expect(as(a,"insert into seo_finding_tasks values($1,$2,'forged',gen_random_uuid())",[wa,report])).rejects.toThrow(/permission denied/);
 await expect(as(a,"update seo_reports set report='{}' where id=$1",[report])).rejects.toThrow(/permission denied/);
});
