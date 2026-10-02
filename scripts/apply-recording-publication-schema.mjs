import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {spawnSync} from 'node:child_process';
const envPath=process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local';
process.loadEnvFile(envPath);
const password=process.env.SUPABASE_DB_PASSWORD || fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
let db;
for(const target of [{host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`},{host:`db.${project}.supabase.co`,port:5432,user:'postgres'}]){
 const candidate=new pg.Client({...target,database:'postgres',password,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:8000});
 try{await candidate.connect();db=candidate;break;}catch{await candidate.end().catch(()=>{});}
}
if(!db)throw new Error('Database connection unavailable');
try{
 await db.query('begin');
 await db.query("set local lock_timeout='8s'; set local statement_timeout='30s'");
 await db.query(fs.readFileSync('supabase/recording_publication_20261002.sql','utf8'));
 const admin=(await db.query("select id from staff_accounts where staff_code='KUDO' and active and role='admin'")).rows;
 if(admin.length!==1)throw new Error('Recording administrator not found');
 const privileges=(await db.query(`select has_table_privilege('anon','recording_publications','select') as anon_read,has_table_privilege('authenticated','recording_publications','select') as authenticated_read,has_function_privilege('anon','save_recording_publication(text,jsonb,text,jsonb,jsonb,text,timestamptz,integer,uuid)','execute') as anon_write`)).rows[0];
 if(Object.values(privileges).some(Boolean))throw new Error('Unexpected public recording access');
 // Preserve the already-hidden emergency lesson, including its restore URL in the private DB.
 if(process.argv.includes('--seed-emergency')){
  const repo=process.argv[process.argv.indexOf('--seed-emergency')+1];
  const result=spawnSync('git',['show','6a0f954:zoom_recording_urls_2026-10.json'],{cwd:repo,encoding:'utf8'});
  if(result.status!==0)throw new Error('Emergency recording source unavailable');
  const entries=JSON.parse(result.stdout).entries;
  const key=Object.keys(entries).find(k=>k.startsWith('2026-10-01|')&&k.includes('|hon|hon_j1_S_math|'));
  if(!key || !entries[key].url)throw new Error('Emergency recording missing');
  const exists=(await db.query('select event_key from recording_publications where event_key=$1',[key])).rowCount;
  if(!exists)await db.query('select save_recording_publication($1,$2,$3,$4,$5,\'private\',null,0,$6)',[key,JSON.stringify([key]),entries[key].url,JSON.stringify([entries[key].url]),JSON.stringify(entries[key]),admin[0].id]);
 }
 await db.query('savepoint recording_validation');
 const key='2099-01-01|18:00～19:00|hon|hon_j1_S_math|1';
 await db.query('select save_recording_publication($1,$2,$3,$4,$5,\'private\',null,0,$6)',[key,JSON.stringify([key]),'https://example.invalid/validation',JSON.stringify(['https://example.invalid/validation']),JSON.stringify({date:'2099-01-01'}),admin[0].id]);
 await db.query('savepoint stale_validation');
 let stale=false;
 try{await db.query('select save_recording_publication($1,$2,$3,$4,$5,\'public\',null,0,$6)',[key,JSON.stringify([key]),'https://example.invalid/validation','[]','{}',admin[0].id]);}catch(e){if(e.code==='PT409'){stale=true;await db.query('rollback to savepoint stale_validation');}else throw e;}
 if(!stale)throw new Error('Stale version was accepted');
 await db.query('rollback to savepoint recording_validation');
 if((await db.query('select 1 from recording_publications where event_key=$1',[key])).rowCount)throw new Error('Validation data remains');
 await db.query(process.argv.includes('--apply')?'commit':'rollback');
 console.log(JSON.stringify({ok:true,applied:process.argv.includes('--apply'),privateUrlsProtected:true,staleWriteRejected:stale,testDataRolledBack:true,...privileges}));
}catch(e){await db.query('rollback').catch(()=>{});console.error('Recording schema rolled back:',e.code || e.message);process.exitCode=1;}finally{await db.end();}
