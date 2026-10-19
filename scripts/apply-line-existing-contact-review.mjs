import fs from 'node:fs';import path from 'node:path';import pg from 'pg';
const root=process.cwd(),parent=path.resolve(root,'../..');
for(const base of [root,parent]){const file=path.join(base,'.env.local');if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}
const apply=process.argv.includes('--apply'),check=process.argv.includes('--check');const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwordFile=[root,parent].map(p=>path.join(p,'supabase で設定したパスワード.txt')).find(p=>fs.existsSync(p));
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync(passwordFile,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=64&&!x.includes(':')).reverse();
let db;for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`]){for(const password of passwords){const candidate=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});try{await candidate.connect();db=candidate;break;}catch{await candidate.end().catch(()=>{});}}if(db)break;}if(!db)throw Error('Database connection unavailable');
try {
 const old=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='verify_existing_line_contact'")).rows;
 const sql=fs.readFileSync('supabase/line_existing_contact_review_20261019.sql','utf8');
 if(check){console.log(JSON.stringify({installed:old.length===1}));if(old.length!==1)process.exitCode=1;}
 else {
 const file=path.join(root,'analysis_outputs/post-interview',`before_existing_contact_review_${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify({capturedAt:new Date().toISOString(),functions:old},null,2),{flag:'wx'});
 await db.query('begin');await db.query("set local lock_timeout='8s';set local statement_timeout='30s'");await db.query(sql);
 const permissions=(await db.query("select has_function_privilege('anon','public.verify_existing_line_contact(text,jsonb,text,text,text)','execute') anon,has_function_privilege('authenticated','public.verify_existing_line_contact(text,jsonb,text,text,text)','execute') authenticated,has_function_privilege('service_role','public.verify_existing_line_contact(text,jsonb,text,text,text)','execute') service")).rows[0];
 if(permissions.anon||permissions.authenticated||!permissions.service)throw Error('Function permissions incorrect');
 await db.query(apply?'commit':'rollback');console.log(JSON.stringify({applied:apply,preview:!apply,permissions,backup:file}));
 }
} catch(error){await db.query('rollback').catch(()=>{});throw error;} finally {await db.end();}
