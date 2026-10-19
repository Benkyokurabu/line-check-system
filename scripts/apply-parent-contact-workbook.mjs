import fs from 'node:fs';import path from 'node:path';import pg from 'pg';
const root=process.cwd(),parent=path.resolve(root,'../..');
for(const base of [root,parent]){const file=path.join(base,'.env.local');if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0],passwordFile=[root,parent].map(p=>path.join(p,'supabase で設定したパスワード.txt')).find(p=>fs.existsSync(p));
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync(passwordFile,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=64&&!x.includes(':')).reverse();
let db;for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`]){for(const password of passwords){const candidate=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});try{await candidate.connect();db=candidate;break;}catch{await candidate.end().catch(()=>{});}}if(db)break;}if(!db)throw Error('Database connection unavailable');
try{
 const apply=process.argv.includes('--apply');await db.query('begin');
 await db.query("set local lock_timeout='8s';set local statement_timeout='30s'");
 const backup={capturedAt:new Date().toISOString(),functions:(await db.query("select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_parent_contact_workbook','release_parent_contact_workbook')")).rows};
 const dir=path.join(root,'analysis_outputs/post-interview');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`before_parent_contact_schema_${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(backup,null,2),{flag:'wx'});
 await db.query(fs.readFileSync('supabase/parent_contact_workbook_20261019.sql','utf8').replace(/^\uFEFF/,''));
 const permissions=(await db.query("select has_function_privilege('anon','public.claim_parent_contact_workbook()','execute') anon,has_function_privilege('authenticated','public.claim_parent_contact_workbook()','execute') authenticated,has_function_privilege('service_role','public.claim_parent_contact_workbook()','execute') service")).rows[0];if(permissions.anon||permissions.authenticated||!permissions.service)throw Error('Unexpected permissions');
 await db.query(apply?'commit':'rollback');console.log(JSON.stringify({applied:apply,preview:!apply,permissions,backup:file}));
}catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{await db.end();}
