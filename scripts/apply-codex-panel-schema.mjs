import fs from 'node:fs';
import pg from 'pg';
process.loadEnvFile('.env.local');
const apply=process.argv.includes('--apply');
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync('supabase で設定したパスワード.txt','utf8').split(/\r?\n/).map(row=>row.trim()).filter(row=>row.length>=12 && row.length<=64 && !row.includes(':')).reverse();
let client;
for(const target of [{host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`},{host:`db.${project}.supabase.co`,port:5432,user:'postgres'}]) {
  for(const password of passwords) {
    const candidate=new pg.Client({...target,database:'postgres',password,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:7000,query_timeout:30000});
    try{await candidate.connect();client=candidate;break;}catch{await candidate.end().catch(()=>{});}
  }
  if(client) break;
}
if(!client) throw new Error('Database connection unavailable');
try {
  await client.query('begin');
  await client.query("set local lock_timeout='8s'; set local statement_timeout='30s'");
  const owner=(await client.query("select id from staff_accounts where staff_code='KUDO' and active and auth_user_id is not null for share")).rows;
  if(owner.length!==1) throw new Error('Owner missing');
  const before=(await client.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bentan_codex_%'")).rows;
  fs.mkdirSync('analysis_outputs/codex-panel',{recursive:true});
  fs.writeFileSync(`analysis_outputs/codex-panel/schema-before-${Date.now()}.json`,JSON.stringify(before),{flag:'wx'});
  await client.query(fs.readFileSync('supabase/codex_panel_20260912.sql','utf8'));
  await client.query('insert into bentan_codex_owner(staff_id) values($1) on conflict do nothing',[owner[0].id]);
  const actual=(await client.query('select staff_id from bentan_codex_owner')).rows;
  if(actual.length!==1 || actual[0].staff_id!==owner[0].id) throw new Error('Owner mismatch');
  const access=(await client.query("select has_table_privilege('anon','bentan_codex_requests','select') a,has_table_privilege('authenticated','bentan_codex_requests','insert') b,has_function_privilege('anon','bentan_codex_action(uuid,uuid,text,jsonb)','execute') c")).rows[0];
  if(Object.values(access).some(Boolean)) throw new Error('Unexpected public access');
  await client.query("notify pgrst, 'reload schema'");
  await client.query(apply?'commit':'rollback');
  console.log(JSON.stringify({ok:true,applied:apply,owner:'KUDO',publicAccess:false}));
} catch(error) {await client.query('rollback').catch(()=>{});console.error(JSON.stringify({ok:false,code:error.code||null}));process.exitCode=1;}
finally{await client.end();}
