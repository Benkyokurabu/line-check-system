import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');
process.loadEnvFile(envPath);
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
const db=new pg.Client({host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
await db.connect();
try{
 await db.query('begin');
 const existing=(await db.query("select to_regclass('public.interview_generated_availability') generated,to_regclass('public.interview_availability_runs') runs")).rows[0];
 const backup={generated:existing.generated?(await db.query('select * from interview_generated_availability order by slot_date,start_time')).rows:[],runs:existing.runs?(await db.query('select * from interview_availability_runs order by created_at')).rows:[]};
 fs.mkdirSync('analysis_outputs/interview-generated-availability-schema',{recursive:true});
 fs.writeFileSync(`analysis_outputs/interview-generated-availability-schema/before-${Date.now()}.json`,JSON.stringify(backup));
 await db.query('rollback');
 await db.query(fs.readFileSync(new URL('../supabase/interview_generated_availability_20260924.sql',import.meta.url),'utf8'));
 await db.query('begin');
 const operation=randomUUID(),page=randomUUID();
 await db.query('insert into interview_generated_availability(teacher,slot_date,start_time,campus,notion_page_id,expected) values($1,$2,$3,$4,$5,$6)', ['検証', '2099-10-01','14:00','本校',page,JSON.stringify({test:true})]);
 await db.query('insert into interview_availability_runs(operation_key,actor,target_month,preview_hash,status) values($1,$2,$3,$4,$5)',[operation,randomUUID(),'2099-10-01','a'.repeat(64),'applying']);
 assert.equal((await db.query("select count(*)::int n from interview_generated_availability where teacher='検証'")).rows[0].n,1);
 await db.query('rollback');
 const access=(await db.query("select has_table_privilege('anon','interview_generated_availability','select') anon_generated,has_table_privilege('authenticated','interview_generated_availability','select') auth_generated,has_table_privilege('service_role','interview_generated_availability','select') service_generated")).rows[0];
 assert.equal(access.anon_generated||access.auth_generated,false);assert.equal(access.service_generated,true);
 console.log(JSON.stringify({applied:true,existingGeneratedPreserved:backup.generated.length,existingRunsPreserved:backup.runs.length,verification:'constraints/rollback/permissions passed'}));
}finally{await db.end();}
