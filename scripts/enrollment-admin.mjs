import fs from 'node:fs';import path from 'node:path';import pg from 'pg';import {createHmac} from 'node:crypto';
const root=process.cwd();const parent=path.resolve(root,'../..');
for(const filename of [path.join(root,'.env.local'),path.join(parent,'.env.local')])if(fs.existsSync(filename))for(const line of fs.readFileSync(filename,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];const passwordFile=[path.join(root,'supabase で設定したパスワード.txt'),path.join(parent,'supabase で設定したパスワード.txt')].find(p=>fs.existsSync(p));
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync(passwordFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>=12&&s.length<=64&&!s.includes(':')).reverse();
let db;for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`]){for(const password of passwords){const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}}if(db)break;}
if(!db)throw Error('Database connection unavailable');
const dir='analysis_outputs/enrollment';fs.mkdirSync(dir,{recursive:true});
try{
 const mode=process.argv[2]??'--inspect';
 if(mode==='--inspect'){console.log(JSON.stringify({schemaExists:(await db.query("select to_regclass('public.enrollment_entries') is not null present")).rows[0].present,staff:(await db.query("select staff_code,role,active from staff_accounts where staff_code in ('KUDO','KINJO')")).rows}));}
 else if(mode==='--apply'){
  await db.query('begin');await db.query("set local lock_timeout='8s'");
  const before=(await db.query("select staff_code,role,active from staff_accounts order by staff_code")).rows;
  const definitions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'enrollment_entry_%'")).rows;
  fs.writeFileSync(path.join(dir,`before_${Date.now()}.json`),JSON.stringify({before,definitions},null,2),{flag:'wx'});
  await db.query(fs.readFileSync('supabase/enrollment_entry_20261017.sql','utf8'));
  const after=(await db.query("select staff_code,role,active from staff_accounts order by staff_code")).rows;if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Staff settings changed');
  const access=(await db.query("select has_table_privilege('anon','enrollment_entries','select') anon_read,has_table_privilege('authenticated','enrollment_entries','select') authenticated_read,has_function_privilege('anon','enrollment_entry_claim(uuid)','execute') anon_claim")).rows[0];if(Object.values(access).some(Boolean))throw Error('Public access detected');
  await db.query('commit');console.log(JSON.stringify({applied:true,staffSettingsUnchanged:true,...access}));
 }else if(mode==='--schedule'){
  const secrets=(await db.query("select name,decrypted_secret from vault.decrypted_secrets where name in ('attendance_app_url','attendance_internal_token')")).rows;
  const token=secrets.find(s=>s.name==='attendance_internal_token')?.decrypted_secret;const expected=createHmac('sha256',process.env.SUPABASE_SECRET_KEY).update('attendance-analysis-cron-v1').digest('hex');
  if(token!==expected||secrets.find(s=>s.name==='attendance_app_url')?.decrypted_secret!=='https://line-check-system.vercel.app')throw Error('Existing cron authentication mismatch');
  const command="select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='attendance_app_url') || '/api/cron/enrollment-sync', headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='attendance_internal_token'),'Content-Type','application/json'),body := '{}'::jsonb,timeout_milliseconds := 55000);";
  await db.query('select cron.schedule($1,$2,$3)',['bentan-enrollment-sync','* * * * *',command]);console.log(JSON.stringify({scheduled:true,job:(await db.query("select jobname,schedule,active from cron.job where jobname='bentan-enrollment-sync'")).rows[0]}));
 }else if(mode==='--status')console.log(JSON.stringify({entries:(await db.query('select status,count(*)::int count from enrollment_entries group by status')).rows,job:(await db.query("select j.jobname,j.active,r.status last_status from cron.job j left join lateral(select status from cron.job_run_details where jobid=j.jobid order by start_time desc limit 1)r on true where j.jobname='bentan-enrollment-sync'")).rows}));
 else throw Error('Unknown mode');
}catch(e){await db.query('rollback').catch(()=>{});throw e;}finally{await db.end();}
