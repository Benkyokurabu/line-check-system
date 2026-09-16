import fs from 'node:fs';import path from 'node:path';import pg from 'pg';
const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'.env.local');process.loadEnvFile(envPath);
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8').trim().split(/\r?\n/)[0];
const db=new pg.Client({host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});await db.connect();
try{
 const exists=(await db.query("select to_regclass('public.survey_confirmations') present")).rows[0].present;
 const before=exists?(await db.query('select * from survey_confirmations')).rows:[];
 fs.mkdirSync('analysis_outputs/survey-confirmations',{recursive:true});fs.writeFileSync(`analysis_outputs/survey-confirmations/before-${Date.now()}.json`,JSON.stringify(before));
 await db.query('begin');await db.query("set local lock_timeout='5s'");await db.query(fs.readFileSync(new URL('../supabase/survey_confirmations_20260916.sql',import.meta.url),'utf8'));
 await db.query('savepoint verification');const staff=(await db.query("select id from staff_accounts where staff_code='KUDO' and active")).rows[0]?.id;if(!staff)throw Error('Staff missing');
 await db.query('select save_survey_confirmations($1,$2)',[staff,JSON.stringify([{pageId:'f'.repeat(32),confirmed:true,version:0}])]);
 await db.query('rollback to verification');
 const rows=(await db.query('select count(*)::integer n from survey_confirmations')).rows[0].n;if(rows!==before.length)throw Error('Unexpected changes');
 const access=(await db.query("select has_table_privilege('anon','survey_confirmations','insert') a,has_function_privilege('authenticated','save_survey_confirmations(uuid,jsonb)','execute') b")).rows[0];if(Object.values(access).some(Boolean))throw Error('Unexpected public privilege');
 await db.query("notify pgrst,'reload schema'");await db.query(process.argv.includes('--apply')?'commit':'rollback');console.log(JSON.stringify({applied:process.argv.includes('--apply'),existingStatesPreserved:rows,testDataRetained:false}));
}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
