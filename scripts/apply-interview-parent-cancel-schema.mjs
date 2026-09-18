import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const arg=name=>process.argv[process.argv.indexOf(name)+1];
const envPath=process.argv.includes('--env')?path.resolve(arg('--env')):path.resolve('.env.local');
for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^["']|["']$/g,'');}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const candidate=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await candidate.connect();db=candidate;break;}catch{await candidate.end().catch(()=>{});}
}
if(!db)throw Error('保存先へ接続できませんでした。');
try{
 const backup={createdAt:new Date().toISOString(),tables:{},functions:[],constraints:[]};
 for(const table of ['interview_parent_requests','interview_request_events','interview_bookings','interview_events'])backup.tables[table]=(await db.query(`select * from public.${table}`)).rows;
 backup.functions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='interview_parent_withdraw'")).rows;
 backup.constraints=(await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.interview_events'::regclass")).rows;
 const dir=path.resolve('analysis_outputs/interview-deployment'),stamp=new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync(dir,{recursive:true});
 const backupPath=path.join(dir,`database.before_parent_cancel_${stamp}.json`);fs.writeFileSync(backupPath,JSON.stringify(backup,null,2));
 if(process.argv.includes('--apply')){
  await db.query(fs.readFileSync(new URL('../supabase/interview_parent_cancel_20260918.sql',import.meta.url),'utf8'));
  const check=(await db.query("select p.prosecdef, a.attnotnull from pg_proc p join pg_namespace n on p.pronamespace=n.oid cross join pg_attribute a where n.nspname='public' and p.proname='interview_parent_withdraw' and a.attrelid='public.interview_events'::regclass and a.attname='actor'")).rows[0];
  if(!check?.prosecdef||check.attnotnull)throw Error('適用後の定義を確認できませんでした。');
  console.log(JSON.stringify({applied:true,backup:backupPath,verified:true}));
 }else console.log(JSON.stringify({applied:false,backup:backupPath,requests:backup.tables.interview_parent_requests.length,bookings:backup.tables.interview_bookings.length}));
}finally{await db.end();}
