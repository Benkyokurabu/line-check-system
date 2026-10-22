import fs from 'node:fs';import path from 'node:path';import pg from 'pg';import {createClient} from '@supabase/supabase-js';
import {syncSchoolContext,notionContextRequest,importContextLineEvents} from '../src/lib/school-context-sync.mjs';
import {importedLineRecord} from '../src/lib/school-context-core.mjs';
import {scheduleSchoolContextJob} from '../src/lib/school-context-cron.mjs';
const root=process.cwd(),parent=path.resolve(root,'../..');
for(const filename of [path.join(root,'.env.local'),path.join(parent,'.env.local')])if(fs.existsSync(filename))for(const line of fs.readFileSync(filename,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}
const args=process.argv.slice(2),apply=args.includes('--apply');
const token=process.env.NOTION_TOKEN??process.env.NOTION_API_KEY;
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function connect(){
 const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
 const passwordFile=[path.join(root,'supabase で設定したパスワード.txt'),path.join(parent,'supabase で設定したパスワード.txt')].find(p=>fs.existsSync(p));
 const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:passwordFile?fs.readFileSync(passwordFile,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>=12&&s.length<=64&&!s.includes(':')).reverse():[];
 for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`])for(const password of passwords){const client=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});try{await client.connect();return client;}catch{await client.end().catch(()=>{});}}
 throw new Error('Database connection unavailable');
}
try{
 if(args.includes('--schema')&&apply){
  const sql=await connect();try{
   await sql.query('begin');await sql.query("set local lock_timeout='8s'");
   const before=(await sql.query('select staff_code,role,active from staff_accounts order by staff_code')).rows;
   await sql.query(fs.readFileSync('supabase/school_context_20261022.sql','utf8'));
   const after=(await sql.query('select staff_code,role,active from staff_accounts order by staff_code')).rows;if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('staff settings changed');
   const rights=(await sql.query("select has_table_privilege('anon','school_context_records','select') anon_read,has_table_privilege('authenticated','school_context_records','select') authenticated_read,has_function_privilege('anon','school_context_ingest(jsonb,jsonb)','execute') anon_ingest,has_function_privilege('authenticated','school_context_read(uuid,uuid,text,text,text,integer)','execute') authenticated_rpc")).rows[0];if(Object.values(rights).some(Boolean))throw new Error('public access detected');
   await sql.query('commit');console.log(JSON.stringify({schemaApplied:true,staffSettingsUnchanged:true,...rights}));
  }catch(error){await sql.query('rollback').catch(()=>{});throw error;}finally{await sql.end();}
 }else if(args.includes('--schedule')){
  const sql=await connect();try{
   if(apply){
    await scheduleSchoolContextJob({sql,secret:process.env.SUPABASE_SECRET_KEY});
   }
   console.log(JSON.stringify({dryRun:!apply,job:(await sql.query("select jobname,schedule,active from cron.job where jobname='bentan-school-context-sync'")).rows}));
  }finally{await sql.end();}
 }else if(args.includes('--sync')){
  if(apply){const batches=Math.min(200,Math.max(1,Number(args[args.indexOf('--batches')+1])||1));for(let i=0;i<batches;i++){const result=await syncSchoolContext({db,token});console.log(JSON.stringify({batch:i+1,...result}));}}
  else{
   const result={dryRun:true,notionTokenConfigured:!!token,notion:null,line:null};
   if(token){try{const page=await notionContextRequest({token})('/search',{filter:{value:'page',property:'object'},page_size:100});result.notion={discoveredOnFirstPage:page.results?.length??null,hasMore:page.has_more,workspaceComplete:false};}catch{result.notion={failed:true};}}
   const rows=await db.from('line_messages').select('id',{count:'exact',head:true});result.line=rows.error?{failed:true}:{storedCount:rows.count};console.log(JSON.stringify(result));
  }
 }else if(args.includes('--import-line')){
  const filename=args[args.indexOf('--import-line')+1];if(!filename)throw new Error('missing_import_file');
  const payload=JSON.parse(fs.readFileSync(filename,'utf8')),events=Array.isArray(payload)?payload:(payload.events??payload.records);
  if(!Array.isArray(events))throw new Error('invalid_import_file');events.forEach(event=>importedLineRecord(event));
  console.log(JSON.stringify(apply?await importContextLineEvents(db,events,payload.coverage??[]):{dryRun:true,validatedEvents:events.length,coverageEntries:payload.coverage?.length??0}));
 }else{
  const result=await db.from('school_context_sources').select('source_type,pending,status',{count:'exact'}).limit(1000);
  console.log(JSON.stringify({dryRun:true,schemaAvailable:!result.error,count:result.count,notionTokenConfigured:!!token,sampledSources:result.data?.length??0,modes:['--schema --apply','--sync [--apply] [--batches N]','--import-line FILE [--apply]','--schedule [--apply]']}));
 }
}catch(error){console.error(JSON.stringify({error:error?.message==='Database connection unavailable'?'Database connection unavailable':'school_context_operation_failed'}));process.exitCode=1;}
