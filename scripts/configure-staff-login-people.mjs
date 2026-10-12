import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { initialLoginNames, loginPersonName } from '../src/lib/staff-login-directory.mjs';
const apply=process.argv.includes('--apply'), envIndex=process.argv.indexOf('--env');
const envPath=path.resolve(envIndex>=0?process.argv[envIndex+1]:'.env.local'),env={};
for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password=env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
}
if(!db)throw Error('DB connection unavailable');
try{
 await db.query('begin');await db.query("set local lock_timeout='5s'");
 const existed=(await db.query("select to_regclass('public.staff_login_people') as present")).rows[0].present;
 const previous=existed?(await db.query('select * from public.staff_login_people order by sort_order')).rows:[];
 const dir=path.resolve('analysis_outputs/persistent-login-backups');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,`people_before_${Date.now()}.json`),JSON.stringify({at:new Date().toISOString(),existed:!!existed,people:previous},null,2));
 const sql=fs.readFileSync(new URL('../supabase/staff_login_people_20261012.sql',import.meta.url),'utf8').replace(/begin;\s*/,'').replace(/commit;\s*$/,'');await db.query(sql);
 await db.query('lock table public.staff_login_people in share row exclusive mode');
 const teachers=(await db.query('select id,display_name from public.teachers')).rows;
 const accounts=(await db.query("select staff_code,display_name,active,role from public.staff_accounts where staff_code like 'AVAIL_%'")).rows;
 let reused=0,inserted=0;
 for(const [index,name] of initialLoginNames.entries()){
  const {nameKey}=loginPersonName(name);
  const existing=(await db.query('select * from public.staff_login_people where name_key=$1',[nameKey])).rows[0];
  if(existing){assert.equal(existing.active,true,'Existing person disabled; refusing reactivation');continue;}
  const aliases=name==='髙山'?['髙山','高山']:name==='佐藤（治）'?['佐藤（治）','治彦']:[name];
  let candidates=teachers.filter(t=>aliases.includes(t.display_name));
  if(candidates.length>1){const exact=candidates.filter(t=>t.display_name===name);if(exact.length===1)candidates=exact;}
  assert.ok(candidates.length<=1,'Ambiguous teacher mapping');
  const teacher=candidates[0],id=teacher?.id??randomUUID(),accountName=teacher?.display_name??name;
  const account=accounts.find(a=>a.staff_code===`AVAIL_${id.replaceAll('-','').toUpperCase()}`);
  if(account){assert.equal(account.display_name,accountName);assert.equal(account.active,true);assert.equal(account.role,'teacher');}
  await db.query('insert into public.staff_login_people(id,display_name,name_key,account_name,sort_order) values($1,$2,$3,$4,$5)',[id,name,nameKey,accountName,index+1]);
  if(teacher)reused++;else inserted++;
 }
 const rows=(await db.query('select display_name from public.staff_login_people where active order by sort_order,display_name')).rows;
 assert.ok(initialLoginNames.every(name=>rows.some(r=>r.display_name===name)));
 await db.query(apply?'commit':'rollback');
 console.log(JSON.stringify({applied:apply,rollbackVerified:!apply,total:rows.length,existingTeacherLinks:reused,newLoginPeople:inserted,names:rows.map(r=>r.display_name),teachersAndCredentialsUnchanged:true}));
}catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{await db.end();}
