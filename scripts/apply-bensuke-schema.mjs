// --apply commits; the default runs the complete migration and rolls it back.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');
const env={};for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const project=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const password=env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
let db;
for(const host of [`db.${project}.supabase.co`,'aws-0-ap-northeast-1.pooler.supabase.com','aws-1-ap-northeast-1.pooler.supabase.com']){
 const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
 try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
}
if(!db)throw Error('本番DBへ接続できませんでした。');
try{
 const backup={createdAt:new Date().toISOString(),tables:{},functions:[],triggers:[]};
 for(const table of ['interview_settings','interview_bookings','interview_events'])backup.tables[table]=(await db.query(`select * from public.${table}`)).rows;
 backup.functions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'interview_%'")).rows;
 backup.triggers=(await db.query("select pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.interview_bookings'::regclass and not tgisinternal")).rows;
 const directory=path.resolve('analysis_outputs/interview-deployment');fs.mkdirSync(directory,{recursive:true});
 const backupPath=path.join(directory,`database.before_bensuke_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
 fs.writeFileSync(backupPath,JSON.stringify(backup,null,2));
 const sql=fs.readFileSync(new URL('../supabase/interview_bensuke_20260916.sql',import.meta.url),'utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
 await db.query('begin');
 await db.query("set local lock_timeout='5s'; set local statement_timeout='30s'");
 await db.query(sql);
 const counts=(await db.query('select (select count(*)::int from interview_bookings) bookings,(select count(*)::int from interview_events) events')).rows[0];
 if(counts.bookings!==backup.tables.interview_bookings.length||counts.events!==backup.tables.interview_events.length)throw Error('予約・履歴件数が変わりました。');
 const grants=(await db.query("select has_function_privilege('anon','interview_bensuke_stage(uuid,uuid,jsonb)','execute') anon,has_function_privilege('authenticated','interview_bensuke_adopt(uuid,uuid,uuid,text,uuid,integer,jsonb,text,text,jsonb,timestamptz)','execute') authenticated")).rows[0];
 if(grants.anon||grants.authenticated)throw Error('関数の権限検証に失敗しました。');
 const applied=process.argv.includes('--apply');await db.query(applied?'commit':'rollback');
 console.log(JSON.stringify({applied,rollbackVerified:!applied,counts,restricted:true,backupPath}));
}catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{await db.end();}
