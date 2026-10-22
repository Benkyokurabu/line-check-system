import fs from 'node:fs';
import {connectBenkeiDatabase,loadBenkeiEnvironment} from './benkei-db.mjs';
import {readAnnouncements} from '../src/lib/benkei-core.mjs';
import {scheduleSchoolContextJob} from '../src/lib/school-context-cron.mjs';
loadBenkeiEnvironment();
const args=process.argv.slice(2),apply=args.includes('--apply');
const db=await connectBenkeiDatabase();
try{
 if(args.includes('--schema')&&apply){
  await db.query('begin');await db.query("set local lock_timeout='8s'");
  try{
   const before=(await db.query('select id,staff_code,role,active from staff_accounts order by id')).rows;
   fs.mkdirSync('analysis_outputs/benkei',{recursive:true});
   fs.writeFileSync(`analysis_outputs/benkei/pre-schema-${Date.now()}.json`,JSON.stringify({staff:before}));
   await db.query(fs.readFileSync('supabase/benkei_home_20261022.sql','utf8'));
   await db.query('insert into bentan_benkei_readers(id,display_name,active) select id,display_name,active from staff_login_people on conflict(id) do update set display_name=excluded.display_name,active=excluded.active');
   // Exact existing account/name mappings only; never infer a person by prefix.
   for(const [code,name] of [['KUDO','工藤'],['KINJO','金城']]){
    const people=(await db.query('select id from staff_login_people where display_name=$1 and active',[name])).rows;
    if(people.length!==1)throw new Error('reader_mapping_ambiguous');
    await db.query('insert into bentan_benkei_reader_accounts(staff_id,reader_id) select id,$2 from staff_accounts where staff_code=$1 on conflict(staff_id) do update set reader_id=excluded.reader_id',[code,people[0].id]);
   }
   await db.query('update bentan_benkei_settings set enabled=true,trial_only=true,page_id=$1 where singleton',['263f0120-80a7-8049-8065-df5ca732ea9b']);
   const after=(await db.query('select id,staff_code,role,active from staff_accounts order by id')).rows;
   if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('staff_changed');
   const rights=(await db.query("select has_table_privilege('anon','bentan_benkei_items','select') a,has_table_privilege('authenticated','bentan_benkei_receipts','select') b,has_function_privilege('authenticated','benkei_confirm(uuid,uuid,uuid,integer,text)','execute') c")).rows[0];
   if(Object.values(rights).some(Boolean))throw new Error('public_access');
   await db.query('commit');console.log(JSON.stringify({schemaApplied:true,trialOnly:true,staffUnchanged:true,readers:(await db.query('select count(*)::int n from bentan_benkei_readers where active')).rows[0].n}));
  }catch(error){await db.query('rollback');throw error;}
 }else if(args.includes('--schedule')&&apply){
  const result=await scheduleSchoolContextJob({sql:db,secret:process.env.SUPABASE_SECRET_KEY,jobName:'bentan-benkei-sync',route:'/api/cron/benkei-sync',schedule:'*/2 * * * *'});
  console.log(JSON.stringify({scheduled:result}));
 }else if(args.includes('--sync')){
  const token=process.env.NOTION_TOKEN??process.env.NOTION_API_KEY;if(!token)throw new Error('token_missing');
  let last=0;
  const request=async path=>{
   const delay=350-(Date.now()-last);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));last=Date.now();
   const response=await fetch(`https://api.notion.com/v1${path}`,{headers:{Authorization:`Bearer ${token}`,'Notion-Version':process.env.NOTION_VERSION??'2025-09-03'}});
   if(!response.ok)throw new Error('notion_fetch_failed');return response.json();
  };
  const items=await readAnnouncements(request);
  if(apply)await db.query('select benkei_complete_sync($1)',[JSON.stringify(items)]);
  console.log(JSON.stringify({dryRun:!apply,announcements:items.length,scope:'upper_shared_announcements',sourceComplete:true}));
 }else console.log(JSON.stringify((await db.query('select (select count(*) from bentan_benkei_readers where active) readers,(select count(*) from bentan_benkei_items where active) items,(select count(*) from bentan_benkei_receipts) receipts')).rows[0]));
}catch{console.error('benkei_operation_failed');process.exitCode=1;}finally{await db.end();}
