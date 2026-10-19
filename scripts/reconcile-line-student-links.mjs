import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import pg from 'pg';
const root=process.cwd(),parent=path.resolve(root,'../..');
for(const base of [root,parent]){const file=path.join(base,'.env.local');if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}
const apply=process.argv.includes('--apply'),check=process.argv.includes('--check');const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwordFile=[root,parent].map(p=>path.join(p,'supabase で設定したパスワード.txt')).find(p=>fs.existsSync(p));
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync(passwordFile,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=64&&!x.includes(':')).reverse();
let db;for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`]){for(const password of passwords){const candidate=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});try{await candidate.connect();db=candidate;break;}catch{await candidate.end().catch(()=>{});}}if(db)break;}if(!db)throw Error('Database connection unavailable');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const coverage=async()=> (await db.query(`select
 (select count(*)::int from student_line_links) saved_links,
 (select count(*)::int from student_line_links l where l.line_user_id ~ '^U[0-9a-fA-F]{32}$' and not exists(select 1 from student_registry s where s.student_number=l.student_number)) orphaned_valid_links,
 (select count(*)::int from student_line_links l join student_registry s using(student_number) where l.line_user_id ~ '^U[0-9a-fA-F]{32}$' and not exists(select 1 from student_line_accounts a where a.student_number=l.student_number and a.line_user_id=l.line_user_id)) missing_registrations,
 exists(select 1 from pg_trigger where tgname='preserve_student_line_registration' and tgenabled<>'D') future_links_preserved`)).rows[0];
try{
 if(check){const result=await coverage();console.log(JSON.stringify(result));if(result.missing_registrations||result.orphaned_valid_links||!result.future_links_preserved)process.exitCode=1;}
 else{
  await db.query('begin');await db.query("set local lock_timeout='8s';set local statement_timeout='30s';lock table student_line_links,student_line_accounts,line_user_aliases in share row exclusive mode");
  const before={};for(const table of ['student_line_links','student_line_accounts','line_user_aliases'])before[table]=(await db.query(`select * from ${table} order by to_jsonb(${table})::text`)).rows;
  const directory=path.join(root,'analysis_outputs/post-interview');fs.mkdirSync(directory,{recursive:true});const backup=path.join(directory,`before_line_link_reconcile_${Date.now()}.json`);fs.writeFileSync(backup,JSON.stringify({capturedAt:new Date().toISOString(),tables:before},null,2),{flag:'wx'});
  const initial=await coverage();await db.query(fs.readFileSync('supabase/line_link_continuity_20261019.sql','utf8'));
  const rows=(await db.query('select * from student_line_accounts')).rows;const byKey=new Map(rows.map(r=>[r.student_number+'|'+r.line_user_id,r]));for(const row of before.student_line_accounts)if(digest(row)!==digest(byKey.get(row.student_number+'|'+row.line_user_id)))throw Error('Existing registration changed');
  const result=await coverage();if(result.missing_registrations||result.orphaned_valid_links||!result.future_links_preserved)throw Error('Registration continuity check failed');
  for(const table of ['student_line_links','line_user_aliases'])if(digest(before[table])!==digest((await db.query(`select * from ${table} order by to_jsonb(${table})::text`)).rows))throw Error('Saved source links or aliases changed');
  await db.query(apply?'commit':'rollback');console.log(JSON.stringify({applied:apply,preview:!apply,added:rows.length-before.student_line_accounts.length,existingRegistrationsUnchanged:true,before:initial,after:result,backup}));
 }
}catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{await db.end();}
