import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const envPath=path.resolve(process.argv.includes('--env')?process.argv[process.argv.indexOf('--env')+1]:'../../.env.local');
process.loadEnvFile(envPath);
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwordText=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync(path.join(path.dirname(envPath),'supabase で設定したパスワード.txt'),'utf8');
const passwords=passwordText.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=64&&!x.includes(' ')).reverse();
let db;
for(const host of [`db.${project}.supabase.co`,'aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com']){
 for(const password of passwords){const client=new pg.Client({host,port:5432,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});
  try{await client.connect();db=client;break;}catch{await client.end().catch(()=>{});}}
 if(db)break;
}
if(!db)throw Error('本番DBへの接続に失敗しました。');
try{
 await db.query('begin');await db.query("set local lock_timeout='5s';set local statement_timeout='30s'");
 const exists=(await db.query("select to_regclass('public.survey_bensuke_links') present")).rows[0].present;
 const before=exists?(await db.query('select * from public.survey_bensuke_links')).rows:[];
 const functions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('survey_bensuke_claim','survey_bensuke_store','survey_bensuke_reserve','interview_survey_bensuke_guard')")).rows;
 fs.mkdirSync('analysis_outputs/survey-bensuke',{recursive:true});fs.writeFileSync(`analysis_outputs/survey-bensuke/schema-before-${Date.now()}.json`,JSON.stringify({tableExisted:!!exists,before,functions}));
 await db.query(fs.readFileSync(new URL('../supabase/survey_bensuke_20261003.sql',import.meta.url),'utf8'));
 if(process.argv.includes('--availability'))await db.query(fs.readFileSync(new URL('../supabase/survey_bensuke_availability_20261003.sql',import.meta.url),'utf8'));
 const access=(await db.query("select has_table_privilege('anon','survey_bensuke_links','select') a,has_function_privilege('authenticated','survey_bensuke_claim(uuid)','execute') b,has_function_privilege('service_role','survey_bensuke_claim(uuid)','execute') service")).rows[0];
 if(access.a||access.b||!access.service)throw Error('連携テーブルの権限検証に失敗しました。');
 if(process.argv.includes('--availability')){const a=(await db.query("select has_table_privilege('anon','survey_bensuke_reservations','select') public_read,has_function_privilege('authenticated','survey_bensuke_reserve(uuid,uuid,uuid)','execute') public_write,has_function_privilege('service_role','survey_bensuke_reserve(uuid,uuid,uuid)','execute') service")).rows[0];if(a.public_read||a.public_write||!a.service)throw Error('予約可の排他権限を確認できません。');}
 await db.query("notify pgrst,'reload schema'");await db.query(process.argv.includes('--apply')?'commit':'rollback');
 console.log(JSON.stringify({applied:process.argv.includes('--apply'),existingLinksPreserved:before.length,permissionsVerified:true}));
}catch(e){await db.query('rollback');throw Error(`連携テーブルの適用失敗 (${e.code??'unknown'})`);}finally{await db.end();}
