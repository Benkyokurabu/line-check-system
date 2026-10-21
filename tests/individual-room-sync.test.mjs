import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {PGlite} from '@electric-sql/pglite';
import {individualRooms,individualDisplayFormula,individualKey,planIndividualRooms} from '../src/lib/individual-room-rules.mjs';
import {parseScheduleWorkbookDetails} from '../src/lib/schedule-excel.mjs';
import {prepareIndividualRoomSync,applyIndividualRoomSync,classifyIndividualSlot} from '../src/lib/individual-room-notion.mjs';
import {BENSUKE_SOURCE_ID} from '../src/lib/teacher-schedule-notion.mjs';
import {syncSchedule,scheduleSyncMonths} from '../src/lib/schedule-sync.mjs';
const month='2026-11',now=new Date('2026-10-21T00:00:00+09:00');
const slot=(room='本①',start='16:45')=>({date:'2026-11-02',start,end:({'16:45':'18:15','18:35':'20:05','20:25':'21:55'})[start],room,status:'free',reason:'',cells:['C7']});
const schema={properties:{
 名前:{id:'title',type:'title'},日時:{id:'date',type:'date'},担当者:{id:'teacher',type:'relation',relation:{data_source_id:'staff'}},
 校舎:{id:'campus',type:'multi_select',multi_select:{options:[{id:'hon',name:'本校'}]}},
 教室:{id:'room',type:'select',select:{options:individualRooms.map(name=>({id:name,name}))}},
 内容:{id:'tag',type:'multi_select',multi_select:{options:['個別指導','個別使用可能'].map(name=>({id:name,name}))}},
 個別表示時刻:{id:'display',type:'formula',formula:{expression:individualDisplayFormula()}},
 個別空き時間帯:{id:'background',type:'formula',formula:{expression:'""'}},
}};
function page(s=slot(),tags=['個別指導','個別使用可能'],extra={}){
 return {id:'existing',parent:{data_source_id:BENSUKE_SOURCE_ID},properties:{
  title:{id:'title',title:[{plain_text:extra.title??'個別使用可能'}]},date:{id:'date',date:extra.date??{start:`${s.date}T${s.start}:00+09:00`,end:null}},
  room:{id:'room',select:s.room?{name:s.room}:null},campus:{id:'campus',multi_select:[{name:'本校'}]},
  teacher:{id:'teacher',relation:extra.teachers??[]},tag:{id:'tag',multi_select:tags.map(name=>({name}))},
 }};
}
function backend(){
 const pages=[],records=new Map(),calls=[];let fail='',sourceCalls=0;
 const view={type:'calendar',data_source_id:BENSUKE_SOURCE_ID,sorts:[{property:'date',direction:'ascending'},{property:'room',direction:'ascending'}],configuration:{date_property_id:'date',properties:[{property_id:'title',visible:true},{property_id:'display',visible:true}]}};
 const db={async rpc(name,a){
  calls.push(name);
  if(name==='individual_room_sync_ready'||name==='schedule_sync_renew')return {data:true};
  const key=a&&`${a.p_date}|${a.p_start}|${a.p_room}`;
  if(name==='individual_room_slot_claim'){
   if(records.has(key))return {data:{...records.get(key),acquired:false}};
   const r={slot_date:a.p_date,start_time:a.p_start,room:a.p_room,status:'uncertain',notion_page_id:null};records.set(key,r);return {data:{...r,acquired:true}};
  }
  if(name==='individual_room_slot_record'){records.set(key,{slot_date:a.p_date,start_time:a.p_start,room:a.p_room,status:a.p_status,notion_page_id:a.p_page});return {data:null};}
  throw Error(name);
 },from(){const q={select:()=>q,gte:()=>q,lt:()=>q,order:()=>q,range:async()=>({data:[...records.values()]})};return q;}};
 const request=async(path,init={})=>{
  if(path===`/data_sources/${BENSUKE_SOURCE_ID}`)return schema;
  if(path.startsWith('/views/'))return view;
  if(path.endsWith('/query'))return {results:pages,has_more:false};
  if(path==='/pages'){
   calls.push('create-page');if(fail==='before')throw Error('timeout');
   const body=JSON.parse(init.body),p=body.properties;
   const made=page({date:p.date.date.start.slice(0,10),start:p.date.date.start.slice(11,16),room:p.room.select.id});made.id=`created-${pages.length}`;
   pages.push(made);if(fail==='after')throw Error('timeout');return made;
  }throw Error(path);
 };
 const report=slots=>({month,source:{sha256:'a'.repeat(64)},roomSchedule:{format:'bentan-room-schedule-v1',month,slots}});
 return {db,request,pages,records,calls,report,setFail:v=>{fail=v;},apply:async prepared=>applyIndividualRoomSync(prepared,{runId:'run',assertSource:async()=>{sourceCalls++;}}),sourceCalls:()=>sourceCalls};
}
test('journal-derived room grid distinguishes cancellations, diagnostics and unresolved merged notes',()=>{
 const wb=XLSX.utils.book_new(),s={};
 const put=(r,c,v)=>{s[XLSX.utils.encode_cell({r:r-1,c:c-1})]={t:typeof v==='number'?'n':'s',v};};
 s['!merges']=[];
 for(let i=0;i<3;i++){
  const c=3+i*5;put(4,c,['16:45～18:15','18:35～20:05','20:25～21:55'][i]);s['!merges'].push({s:{r:3,c:c-1},e:{r:3,c:c+3}});
  for(let j=0;j<5;j++)put(5,c+j,['①','②','③','④','⑥'][j]);
 }
 put(7,1,2);put(7,2,'月');put(8,1,3);put(8,2,'火');put(9,1,8);put(9,2,'日');
 put(7,3,'１Ｓ英');put(7,4,'６Ａ算 休講');put(7,5,'診断');put(7,6,'先生休み');put(7,7,'学校行事');
 put(8,8,'オンライン対策\n詳細は後日');s['!merges'].push({s:{r:7,c:7},e:{r:7,c:11}});put(8,13,'２Ｓ国');
 s['!ref']='A1:Q54';XLSX.utils.book_append_sheet(wb,s,'本校教務部用');
 const {roomSchedule}=parseScheduleWorkbookDetails(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),month);
 const get=(date,start,room)=>roomSchedule.slots.find(s=>s.date===date&&s.start===start&&s.room===room);
 assert.equal(get('2026-11-02','16:45','本①').status,'occupied');
 assert.equal(get('2026-11-02','16:45','本②').status,'free');
 assert.equal(get('2026-11-02','16:45','本③').status,'occupied');
 assert.equal(get('2026-11-02','16:45','本④').status,'free');
 assert.equal(get('2026-11-02','16:45','本⑥').status,'review');
 assert.ok(roomSchedule.slots.filter(s=>s.date==='2026-11-03'&&s.start==='18:35').every(s=>s.status==='review'));
 const planned=planIndividualRooms(roomSchedule,new Date('2026-11-02T17:00:00+09:00'));
 assert.ok(planned.every(s=>s.date!=='2026-11-08'&&individualRooms.includes(s.room)));
 assert.ok(!planned.some(s=>s.date==='2026-11-02'&&s.start==='16:45'));
});
test('unassigned availability and teacher leave do not consume every room; booked and long events do',()=>{
 assert.equal(classifyIndividualSlot(slot(),[page(slot(''),['個別指導','個別使用可能']),page(slot(),['休み'],{teachers:[{id:'staff'}]})],schema).action,'create');
 assert.equal(classifyIndividualSlot(slot(),[page(slot(),['個別指導'])],schema).action,'blocked');
 assert.equal(classifyIndividualSlot(slot(),[page(slot(''),['面談(対面)'])],schema).action,'review');
 assert.equal(classifyIndividualSlot(slot(),[page(slot(''),['休み'])],schema).action,'blocked');
 assert.equal(classifyIndividualSlot(slot(),[page(slot(),['授業'],{date:{start:'2026-10-01',end:'2026-11-03'}})],schema).action,'blocked');
 assert.equal(classifyIndividualSlot(slot('本②'),[page(slot(''),undefined,{title:'①③ 個別使用可能'})],schema).action,'create');
 assert.equal(classifyIndividualSlot(slot('本③'),[page(slot(''),undefined,{title:'①③ 個別使用可能'})],schema).action,'existing');
});
test('retry adopts an uncertain successful POST, and never resends an uncertain missing POST',async()=>{
 for(const failure of ['before','after']){
  const b=backend();b.setFail(failure);
  await assert.rejects(b.apply(await prepareIndividualRoomSync(b.db,b.report([slot()]),{now,request:b.request})),/timeout/);
  assert.equal(b.records.get(individualKey(slot())).status,'uncertain');
  b.setFail('');const retry=await b.apply(await prepareIndividualRoomSync(b.db,b.report([slot()]),{now,request:b.request}));
  assert.equal(b.calls.filter(x=>x==='create-page').length,1);
  assert.equal(retry[failure==='after'?'existing':'review'],1);
 }
});
test('reimport protects a recorded card even after it is booked/moved, refreshes late bookings, and respects batch limits',async()=>{
 const b=backend(),slots=[slot(),slot('本②')];
 let prepared=await prepareIndividualRoomSync(b.db,b.report(slots),{now,request:b.request});
 const first=await applyIndividualRoomSync(prepared,{runId:'run',assertSource:async()=>{},maxCreates:1});
 assert.equal(first.created,1);assert.equal(first.pending,1);
 b.pages[0].properties.room.select={name:'本④'};b.pages[0].properties.tag.multi_select=[{name:'個別指導'}];
 prepared=await prepareIndividualRoomSync(b.db,b.report(slots),{now,request:b.request});
 b.pages.push(page(slot('本②'),['個別指導']));
 const second=await b.apply(prepared);assert.equal(second.recorded,1);assert.equal(second.blocked,1);
 assert.equal(b.calls.filter(x=>x==='create-page').length,1);
});
test('source changes and lost leases stop before a Notion write; existing conflicts are reported without modifying cards',async()=>{
 const b=backend();let p=await prepareIndividualRoomSync(b.db,b.report([slot()]),{now,request:b.request});
 await assert.rejects(applyIndividualRoomSync(p,{runId:'run',assertSource:async()=>{throw Error('source changed');}}),/source changed/);
 assert.ok(!b.calls.includes('create-page'));
 b.pages.push(page());p=await prepareIndividualRoomSync(b.db,b.report([{...slot(),status:'occupied'}]),{now,request:b.request});
 assert.equal((await b.apply(p)).review,1);assert.equal(b.pages.length,1);
 b.db.rpc=async()=>({data:false});await assert.rejects(b.apply(p),/実行権限/);
});
test('room creation runs after an unchanged lesson import and exposes pending/review status',async()=>{
 const calls=[],report={month,source:{modifiedAt:'2026-10-01T00:00:00Z'},summary:{},changes:[],lessons:[{campus:'本校'},{campus:'南教室'}]};
 const db={async rpc(n,a){calls.push([n,a]);return {data:n==='schedule_sync_claim'?'run':n==='schedule_sync_v2_ready'?true:n==='schedule_sync_apply_v2'?{status:'unchanged'}:null};}};
 const result=await syncSchedule(db,month,'key',{now,listMonths:async()=>[{month}],preview:async()=>report,prepareTeacherNotionSync:async()=>({items:[]}),prepareIndividualRoomSync:async()=>({}),applyIndividualRoomSync:async()=>({created:1,existing:0,recorded:0,blocked:2,review:0,pending:3,details:[]})});
 assert.equal(result.status,'waiting');assert.match(result.message,/残り3枠/);
 assert.equal(calls.at(-1)[1].p_report.summary.individualRooms.created,1);
});
test('durable slot claims serialize retries, audit results and reject browser roles or lost leases',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  const schema=fs.readFileSync(new URL('../supabase/attendance_schema.sql',import.meta.url),'utf8');await db.exec(schema.slice(0,schema.indexOf('create index')));
  await db.exec(fs.readFileSync(new URL('../supabase/schedule_sync.sql',import.meta.url),'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/individual_room_sync_20261021.sql',import.meta.url),'utf8'));
  await db.exec('update schedule_sync_control set enabled=true');
  const m=scheduleSyncMonths()[1],date=`${m}-02`,run=(await db.query("select schedule_sync_claim($1,'manual') id",[m])).rows[0].id;
  const args=[run,date,'16:45','本①','a'.repeat(64)];
  const claim=()=>db.query('select individual_room_slot_claim($1,$2,$3,$4,$5) r',args);
  assert.equal((await claim()).rows[0].r.acquired,true);assert.equal((await claim()).rows[0].r.acquired,false);
  assert.equal((await db.query('select status from individual_room_slots')).rows[0].status,'uncertain');
  await db.query("select individual_room_slot_record($1,$2,$3,$4,$5,$6,'created')",[...args,'00000000-0000-4000-8000-000000000001']);
  assert.equal((await claim()).rows[0].r.notion_page_id,'00000000-0000-4000-8000-000000000001');
  await assert.rejects(db.query("select individual_room_slot_record($1,$2,$3,$4,$5,$6,'existing')",[...args,'00000000-0000-4000-8000-000000000002']),/already bound/);
  assert.equal((await db.query('select count(*)::int n from individual_room_events')).rows[0].n,2);
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);await assert.rejects(claim(),/permission denied/);await assert.rejects(db.query('select * from individual_room_slots'),/permission denied/);await assert.rejects(db.query('select schedule_sync_renew($1)',[run]),/permission denied/);await db.exec('reset role');
  }
  await db.exec("update schedule_sync_control set lease_until=now()-interval '1 minute'");
  assert.equal((await db.query('select schedule_sync_renew($1) r',[run])).rows[0].r,false);await assert.rejects(claim(),/lease lost/);
 }finally{await db.close();}
});
