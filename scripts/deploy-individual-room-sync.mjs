// Operator-only deployment/verification. No credentials or appointment contents in stdout.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {individualDisplayFormula} from '../src/lib/individual-room-rules.mjs';
import {getScheduleCloudPreview} from '../src/lib/schedule-cloud.mjs';
import {prepareIndividualRoomSync} from '../src/lib/individual-room-notion.mjs';
import {createTeacherNotionRequest,BENSUKE_SOURCE_ID} from '../src/lib/teacher-schedule-notion.mjs';
import {syncSchedule,scheduleSyncBlockers} from '../src/lib/schedule-sync.mjs';
const mode=process.argv[2]||'help';
if(mode==='help'){console.log('Usage: deploy-individual-room-sync.mjs inspect|apply|preview MONTH|run MONTH');process.exit(0);}
if(!['inspect','apply','preview','run'].includes(mode))throw Error('Unknown mode');
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z0-9_]+)=(.*)$/u);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
if(!process.env.NOTION_TOKEN&&!process.env.NOTION_API_KEY){const f=path.join(os.homedir(),'.codex','notion_token.txt');if(fs.existsSync(f))process.env.NOTION_TOKEN=fs.readFileSync(f,'utf8').trim();}
const dbClient=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const dir='.private/kobetsu-20261021';fs.mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
if(['preview','run'].includes(mode)){
 const month=process.argv[3];
 if(mode==='run'){
  const result=await syncSchedule(dbClient,month,process.env.SUPABASE_SECRET_KEY);
  fs.writeFileSync(`${dir}/auto-sync-run-${month}-${stamp}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }else{
  const report=await getScheduleCloudPreview(dbClient,month,process.env.SUPABASE_SECRET_KEY,fetch,{includeSnapshot:true});
  const prepared=await prepareIndividualRoomSync(dbClient,report);
  const result={month,source:report.source,lessons:report.summary,blockers:scheduleSyncBlockers(report),individualRooms:Object.fromEntries(['create','existing','recorded','blocked','review'].map(k=>[k,prepared.items.filter(s=>s.action===k).length])),details:prepared.items.filter(s=>s.action==='review').map(s=>({date:s.date,start:s.start,room:s.room,reason:s.reason}))};
  fs.writeFileSync(`${dir}/auto-sync-preview-${month}-${stamp}.json`,JSON.stringify({report,items:prepared.items.map(({record,...s})=>({...s,record:record??null}))},null,2));
  console.log(JSON.stringify(result));
 }process.exit(0);
}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password=process.env.SUPABASE_DB_PASSWORD||fs.readFileSync('supabase で設定したパスワード.txt','utf8').trim().split(/\r?\n/u)[0];
const hosts=[{host:`db.${project}.supabase.co`,port:5432,user:'postgres'},...['ap-northeast-1','ap-northeast-2','ap-southeast-1'].flatMap(r=>[0,1].map(n=>({host:`aws-${n}-${r}.pooler.supabase.com`,port:6543,user:`postgres.${project}`})))];
let db;
for(const host of hosts){const c=new pg.Client({...host,database:'postgres',password,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000});try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}}
if(!db)throw Error('保存先へ接続できませんでした。');
try{
 const definitions=(await db.query("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and (proname like 'individual_room_%' or proname='schedule_sync_renew')")).rows;
 const table=(await db.query("select to_regclass('public.individual_room_slots') is not null ready")).rows[0].ready;
 const request=createTeacherNotionRequest(process.env.NOTION_TOKEN||process.env.NOTION_API_KEY);
 const before=await request(`/data_sources/${BENSUKE_SOURCE_ID}`),current=before.properties['個別表示時刻'];
 if(mode==='inspect'){
  console.log(JSON.stringify({sql_functions:definitions.map(x=>x.proname),table_ready:table,general_display_formula:current?.formula?.expression===individualDisplayFormula(),schedule_sync:(await db.query('select enabled,lease_until from schedule_sync_control')).rows}));
 }else{
  if(current?.formula?.expression!==individualDisplayFormula()){
   const saved=fs.readdirSync(dir).filter(n=>n.startsWith('text-time-source-after-')).sort().at(-1);
   const original=saved?JSON.parse(fs.readFileSync(`${dir}/${saved}`,'utf8')).properties['個別表示時刻']:null;
   if(!original||current?.id!==original.id||current?.formula?.expression!==original.formula.expression)throw Error('現在の表示数式が保存済みの式と異なります。上書きせず停止します。');
  }
  fs.writeFileSync(`${dir}/auto-sync-schema-before-${stamp}.json`,JSON.stringify({definitions,source:before},null,2),{flag:'wx'});
  await db.query(fs.readFileSync(new URL('../supabase/individual_room_sync_20261021.sql',import.meta.url),'utf8'));
  if(current.formula.expression!==individualDisplayFormula())await request(`/data_sources/${BENSUKE_SOURCE_ID}`,{method:'PATCH',body:JSON.stringify({properties:{個別表示時刻:{formula:{expression:individualDisplayFormula()}}}})});
  const after=await request(`/data_sources/${BENSUKE_SOURCE_ID}`);
  if(after.properties['個別表示時刻'].formula.expression!==individualDisplayFormula())throw Error('表示数式の保存確認に失敗しました。');
  const checks=(await db.query("select individual_room_sync_ready() ready,has_function_privilege('anon','public.individual_room_slot_claim(uuid,date,text,text,text)','EXECUTE') anonymous_write,has_table_privilege('authenticated','public.individual_room_slots','SELECT') browser_read")).rows[0];
  if(!checks.ready||checks.anonymous_write||checks.browser_read)throw Error('保存先の権限検証に失敗しました。');
  fs.writeFileSync(`${dir}/auto-sync-schema-result-${stamp}.json`,JSON.stringify(checks,null,2));console.log(JSON.stringify({applied:true,...checks,all_months_text_formula:true}));
 }
}finally{await db.end();}
