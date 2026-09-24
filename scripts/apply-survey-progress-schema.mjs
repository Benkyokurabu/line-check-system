import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');
process.loadEnvFile(envPath);
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
const db=new pg.Client({host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
await db.connect();
try{
 await db.query('begin');
 await db.query("set local lock_timeout='5s'; lock table public.survey_confirmations in share row exclusive mode");
 const before=(await db.query('select page_id,confirmed,version,updated_by,updated_at from survey_confirmations order by page_id')).rows;
 const functions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_survey_confirmations','save_shared_survey_confirmations')")).rows;
 fs.mkdirSync('analysis_outputs/survey-progress-schema',{recursive:true});
 fs.writeFileSync(`analysis_outputs/survey-progress-schema/before-${Date.now()}.json`,JSON.stringify({before,functions}));
 await db.query(fs.readFileSync(new URL('../supabase/survey_progress_20260924.sql',import.meta.url),'utf8'));
 await db.query('savepoint verification');
 const id=randomUUID().replaceAll('-','');let version=0;
 for(const progress of ['needs-review','handled','coordinating','scheduled','completed']){
  await db.query('select save_shared_survey_confirmations($1)',[JSON.stringify([{pageId:id,progress,version}])]);
  version++;
  const saved=(await db.query('select confirmed,progress_status,version from survey_confirmations where page_id=$1',[id])).rows[0];
  assert.deepEqual(saved,{confirmed:progress!=='needs-review',progress_status:progress,version});
 }
 await db.query('rollback to verification');
 assert.deepEqual((await db.query('select page_id,confirmed,version,updated_by,updated_at from survey_confirmations order by page_id')).rows,before);
 const access=(await db.query("select has_table_privilege('anon','survey_confirmations','insert') a,has_function_privilege('anon','save_shared_survey_confirmations(jsonb)','execute') b,has_function_privilege('authenticated','save_shared_survey_confirmations(jsonb)','execute') c,has_function_privilege('service_role','save_shared_survey_confirmations(jsonb)','execute') service")).rows[0];
 assert.equal(access.a||access.b||access.c,false);assert.equal(access.service,true);
 await db.query("notify pgrst,'reload schema'");
 await db.query(process.argv.includes('--apply')?'commit':'rollback');
 console.log(JSON.stringify({applied:process.argv.includes('--apply'),existingStatesPreserved:before.length,verification:'all five progress values/save/undo/permissions passed',testDataRetained:false}));
}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
