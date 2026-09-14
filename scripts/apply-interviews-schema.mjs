// Operator deployment. Back up existing interview data before applying the additive migration.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const envPath=process.argv.includes('--env')?path.resolve(arg('--env')):path.resolve('.env.local');
for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
}
if(!db)throw Error('保存先へ接続できませんでした。');
try{
 const tables=['interview_settings','interview_students','interview_bookings','interview_slot_overrides','interview_events'];
 const backup={createdAt:new Date().toISOString(),tables:{},functions:[]};
 for(const table of tables){const exists=(await db.query('select to_regclass($1) present',[`public.${table}`])).rows[0].present;backup.tables[table]=exists?(await db.query(`select * from public.${table}`)).rows:null;}
 backup.functions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'interview_%'")).rows;
 const dir=path.resolve('analysis_outputs/interview-deployment');fs.mkdirSync(dir,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 fs.writeFileSync(path.join(dir,`database.before_interviews_${stamp}.json`),JSON.stringify(backup,null,2));
 if(process.argv.includes('--apply')){
  await db.query(fs.readFileSync(new URL('../supabase/interviews_20260914.sql',import.meta.url),'utf8'));
  console.log(JSON.stringify({applied:true,backup:path.join(dir,`database.before_interviews_${stamp}.json`),students:(await db.query('select count(*)::int n from interview_students')).rows[0].n}));
 }else console.log(JSON.stringify({applied:false,existing:Object.fromEntries(Object.entries(backup.tables).map(([k,v])=>[k,v?.length??null]))}));
}finally{await db.end();}
