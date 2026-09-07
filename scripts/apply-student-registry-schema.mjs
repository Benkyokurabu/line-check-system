import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

// Default mode verifies the migration in a transaction and rolls it back.
const apply = process.argv.includes('--apply');
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m=line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if(m && !process.env[m[1]]) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');
}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwords=process.env.SUPABASE_DB_PASSWORD ? [process.env.SUPABASE_DB_PASSWORD] :
  fs.readFileSync('supabase で設定したパスワード.txt','utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12 && x.length<=64 && !x.includes(':')).reverse();
const targets=[{host:'aws-1-ap-northeast-1.pooler.supabase.com',port:6543,user:`postgres.${project}`},
  {host:`db.${project}.supabase.co`,port:5432,user:'postgres'}];
const fingerprint=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
let client;
for(const target of targets) {
  for(const password of passwords) {
    const candidate=new pg.Client({...target,database:'postgres',password,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:7000,query_timeout:30000});
    try {await candidate.connect();client=candidate;break;} catch {await candidate.end().catch(()=>{});}
  }
  if(client) break;
}
if(!client) throw new Error('Database connection unavailable');
try {
  await client.query('begin');
  await client.query("set local lock_timeout='8s'; set local statement_timeout='30s';");
  await client.query('lock table public.student_roster,public.student_line_accounts,public.line_contact_registration_events in share row exclusive mode');
  const tables=['student_roster','student_line_accounts','student_line_links','line_contact_registration_events','line_user_aliases'];
  async function snapshot() {
    const result={};
    for(const table of tables) result[table]=(await client.query(`select * from public.${table} order by to_jsonb(${table})::text`)).rows;
    return result;
  }
  const before=await snapshot();
  const definitions=(await client.query(`select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('verify_line_contact','get_line_contact_admin_summaries')`)).rows;
  const constraints=(await client.query("select conrelid::regclass::text relation,conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid in ('public.student_line_accounts'::regclass,'public.line_contact_registration_events'::regclass)")).rows;
  const directory=path.resolve('analysis_outputs/student-registry-migration');
  fs.mkdirSync(directory,{recursive:true});
  const backup=path.join(directory,`before_${Date.now()}.json`);
  fs.writeFileSync(backup,JSON.stringify({captured_at:new Date().toISOString(),before,definitions,constraints}),{flag:'wx'});
  await client.query(fs.readFileSync('supabase/student_registry_20260907.sql','utf8'));
  const after=await snapshot();
  for(const table of tables) if(fingerprint(before[table])!==fingerprint(after[table])) throw new Error(`Unexpected existing data change: ${table}`);
  const integrity=(await client.query(`select
    (select count(*)::int from public.student_registry) registry_count,
    (select count(*)::int from public.student_roster r left join public.student_registry s using(student_number) where s.student_number is null) missing_people,
    (select count(*)::int from public.get_line_contact_admin_summaries()) summary_count,
    has_function_privilege('anon','public.register_study_room_former_student(jsonb,text,text,text)','execute') anonymous_execute`)).rows[0];
  if(integrity.missing_people || integrity.anonymous_execute) throw new Error('Registry integrity verification failed');
  await client.query(apply?'commit':'rollback');
  console.log(JSON.stringify({ok:true,applied:apply,roster_count:before.student_roster.length,existing_data_unchanged:true,...integrity,backup:path.relative(process.cwd(),backup)}));
} catch(error) {
  await client.query('rollback').catch(()=>{});
  console.error(JSON.stringify({ok:false,code:error.code??null,error:'Migration failed; transaction rolled back'}));
  process.exitCode=1;
} finally { await client.end(); }
