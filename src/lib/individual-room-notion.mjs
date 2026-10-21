import {bookingSchema,scheduleValue,scheduleProperties,equivalentSchedule,queryPages} from './bensuke-booking.mjs';
import {createTeacherNotionRequest,BENSUKE_SOURCE_ID} from './teacher-schedule-notion.mjs';
import {individualRooms,individualKey,individualDisplayFormula,planIndividualRooms} from './individual-room-rules.mjs';

const VIEW='39ef0120-80a7-803b-8303-000c4a846891';
const DISPLAY='個別表示時刻';
const ROOM_COLORS='①②③④⑤⑥⑦⑧⑨';
const slotValue=s=>({title:'個別使用可能',date:{start:`${s.date}T${s.start}:00+09:00`,end:null,time_zone:null},teachers:[],campuses:['本校'],room:s.room,tags:['個別指導','個別使用可能']});
const sameStart=(a,b)=>a&&Date.parse(a)===Date.parse(b);
function interval(date){
  if(!date?.start)return null;
  const timed=date.start.includes('T');
  const a=Date.parse(timed?date.start:`${date.start}T00:00:00+09:00`);
  let b=date.end?Date.parse(date.end.includes('T')?date.end:`${date.end}T00:00:00+09:00`)+(date.end.includes('T')?0:86400000):a+(timed?90*60000:86400000);
  if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('既存予定の時間を確認できません。');
  if(b<=a)b=a+(timed?90*60000:86400000);
  return [a,b];
}

export function classifyIndividualSlot(slot,pages,schema){
  const a=Date.parse(`${slot.date}T${slot.start}:00+09:00`),b=Date.parse(`${slot.date}T${slot.end}:00+09:00`);
  const available=[],busy=[],unknown=[];
  for(const entry of pages){
    const p=entry.page??entry;
    if(p.archived||p.in_trash)continue;
    const v=entry.value??scheduleValue(p,schema),r=entry.value?entry.interval:interval(v.date);
    if(!r||r[0]>=b||a>=r[1])continue;
    // A teacher's leave or bookable interview time is not classroom occupancy.
    if(v.tags.includes('休み')&&v.teachers.length||v.tags.some(t=>t.endsWith('予約可')))continue;
    const free=v.tags.includes('個別使用可能');
    const named=free&&!v.room?[...v.title].filter(c=>ROOM_COLORS.includes(c)).map(c=>`本${c}`):[];
    const exactRoom=v.room===slot.room||!v.room&&named.includes(slot.room);
    if(exactRoom){
      if(free&&sameStart(v.date.start,`${slot.date}T${slot.start}:00+09:00`))available.push(p);
      else busy.push(p);
      continue;
    }
    if(v.room||!v.campuses.includes('本校'))continue;
    // An unassigned empty card cannot occupy every classroom.
    if(free)continue;
    // Explicit diagnostic cells already identify the affected room in this band.
    if(v.tags.includes('診断テスト')&&slot.diagnosticInBand)continue;
    if(v.tags.includes('休み')&&!v.teachers.length)busy.push(p);
    else if(v.tags.some(t=>/個別指導|面談|診断|入会|見学|授業/u.test(t)))unknown.push(p);
  }
  if(busy.length)return {action:'blocked',reason:'Notionに教室使用予定あり'};
  if(unknown.length)return {action:'review',reason:'教室未指定の使用予定の確認が必要'};
  if(available.length>1)return {action:'review',reason:'同じ教室・時刻に既存の空き枠が複数ある'};
  if(available.length)return {action:'existing',pageId:available[0].id};
  return {action:'create'};
}

async function rpc(db,name,args){
  const {data,error}=await db.rpc(name,args);
  if(error)throw Error('個別枠の処理記録を確認できません。次回の取込で再確認します。');
  return data;
}
async function ledger(db,month){
  const result=[];
  for(let offset=0;offset<2000;offset+=500){
    const response=await db.from('individual_room_slots').select('slot_date,start_time,room,status,notion_page_id').gte('slot_date',`${month}-01`).lt('slot_date',new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)).order('slot_date').order('start_time').order('room').range(offset,offset+499);
    if(response.error)throw Error('個別枠の登録履歴を取得できません。');
    result.push(...response.data);if(response.data.length<500)return result;
  }
  throw Error('個別枠の登録履歴が上限を超えました。');
}
function validateSchema(schema){
  const f=bookingSchema(schema);
  for(const [field,names]of [[f.room,individualRooms],[f.tags,['個別指導','個別使用可能']],[f.campuses,['本校']]])for(const name of names)if(!field[field.type].options.some(o=>o.name===name))throw Error('Notionの個別枠に必要な選択肢を確認できません。');
  if(schema.properties[DISPLAY]&&(schema.properties[DISPLAY].type!=='formula'||schema.properties[DISPLAY].formula.expression!==individualDisplayFormula()))throw Error('個別表示時刻の数式が取込用のルールと異なります。管理担当者に確認してください。');
  if(schema.properties['個別空き時間帯']?.formula?.expression&&schema.properties['個別空き時間帯'].formula.expression!=='""')throw Error('時間帯の背景色設定が有効です。文字色の設定を確認してください。');
  return f;
}

export async function prepareIndividualRoomSync(db,report,options={}){
  if(await rpc(db,'individual_room_sync_ready',{})!==true)throw Error('個別枠の自動作成用SQLを確認できません。');
  const slots=planIndividualRooms(report.roomSchedule,options.now),month=report.month;
  if(!/^[a-f0-9]{64}$/u.test(report.source?.sha256??''))throw Error('原本の照合情報が不足しています。');
  const request=options.request??createTeacherNotionRequest(process.env.NOTION_TOKEN||process.env.NOTION_API_KEY);
  const schema=await request(`/data_sources/${BENSUKE_SOURCE_ID}`),fields=validateSchema(schema);
  const stored=await ledger(db,month),records=new Map(stored.map(s=>[`${s.slot_date}|${s.start_time}|${s.room}`,s]));
  const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  // No lower bound: a multi-day booking may have started before this month.
  const pages=slots.length?await queryPages(request,BENSUKE_SOURCE_ID,{and:[
    {property:fields.date.id,date:{on_or_before:`${last}T23:59:59+09:00`}},
    {or:[{property:fields.campuses.id,multi_select:{contains:'本校'}},...individualRooms.map(room=>({property:fields.room.id,select:{equals:room}}))]},
    {or:[{property:fields.date.id,date:{on_or_after:`${month}-01T00:00:00+09:00`}},{property:fields.tags.id,multi_select:{does_not_contain:'個別使用可能'}}]},
    {property:fields.tags.id,multi_select:{does_not_contain:'本：予約可'}},
    {property:fields.tags.id,multi_select:{does_not_contain:'南：予約可'}},
    {or:[{property:fields.teachers.id,relation:{is_empty:true}},{property:fields.tags.id,multi_select:{does_not_contain:'休み'}}]},
  ]},100):[];
  const values=pages.map(page=>{const value=scheduleValue(page,schema);return {page,value,interval:interval(value.date)};});
  const diagnostics=new Set(slots.filter(s=>s.uses?.includes('診断')).map(s=>`${s.date}|${s.start}`));
  const items=slots.map(s=>{
    const slot={...s,diagnosticInBand:diagnostics.has(`${s.date}|${s.start}`)},record=records.get(individualKey(s));
    const current=classifyIndividualSlot(slot,values,schema);
    if(s.status!=='free')return {...slot,record,action:current.action==='existing'?'review':s.status==='occupied'?'blocked':'review',reason:current.action==='existing'?'授業・未確定予定と既存の空き枠が重複':s.reason};
    if(record?.notion_page_id)return {...slot,record,action:'recorded'};
    if(record?.status==='uncertain'&&current.action!=='existing')return {...slot,record,action:'review',reason:'前回の作成応答が不明です。重複防止のため再作成せず確認待ち'};
    return {...slot,record,...current};
  });
  return {db,request,schema,fields,items,month,hash:report.source.sha256};
}

export async function ensureIndividualRoomPresentation(prepared){
  const {request}=prepared;
  let schema=await request(`/data_sources/${BENSUKE_SOURCE_ID}`);validateSchema(schema);
  if(!schema.properties[DISPLAY])schema=await request(`/data_sources/${BENSUKE_SOURCE_ID}`,{method:'PATCH',body:JSON.stringify({properties:{[DISPLAY]:{formula:{expression:individualDisplayFormula()}}}})});
  const id=decodeURIComponent(schema.properties[DISPLAY].id),view=await request(`/views/${VIEW}`,{headers:{'Notion-Version':'2026-03-11'}});
  if(view.type!=='calendar'||view.data_source_id!==BENSUKE_SOURCE_ID)throw Error('本校個別のカレンダーを確認できません。');
  const expected=[{property:decodeURIComponent(prepared.fields.date.id),direction:'ascending'},{property:decodeURIComponent(prepared.fields.room.id),direction:'ascending'}];
  const current=view.configuration.properties??[],update={};
  if(JSON.stringify(view.sorts)!==JSON.stringify(expected))update.sorts=expected;
  if(!current.some(p=>decodeURIComponent(p.property_id)===id&&p.visible)){
    const properties=current.filter(p=>decodeURIComponent(p.property_id)!==id).map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='property_name')));
    properties.splice(Math.max(0,properties.findIndex(p=>p.property_id==='title')+1),0,{property_id:id,visible:true});
    update.configuration={type:'calendar',date_property_id:view.configuration.date_property_id,properties};
  }
  if(Object.keys(update).length)await request(`/views/${VIEW}`,{method:'PATCH',headers:{'Notion-Version':'2026-03-11'},body:JSON.stringify(update)});
  prepared.schema=schema;
}

export async function applyIndividualRoomSync(prepared,{runId,assertSource,deadline=Infinity,clock=Date.now,maxCreates=10,maxWrites=20}={}){
  const {db,request,fields,hash}=prepared;
  if(!runId||typeof assertSource!=='function')throw Error('個別枠の反映条件が不足しています。');
  const renew=async()=>{if(await rpc(db,'schedule_sync_renew',{p_run:runId})!==true)throw Error('取込の実行権限が失われたため個別枠の作成を停止しました。');};
  await renew();await ensureIndividualRoomPresentation(prepared);
  const result={created:0,existing:0,recorded:0,blocked:0,review:0,pending:0,details:[]};let writes=0;
  for(const s of prepared.items){
    if(['blocked','review','recorded'].includes(s.action)){
      result[s.action]++;
      if(s.action==='review'&&result.details.length<60)result.details.push({date:s.date,start:s.start,room:s.room,reason:s.reason});
      continue;
    }
    if(writes>=maxWrites||clock()>deadline-5000){result.pending++;continue;}
    await renew();
    // Recording an already-seen card cannot change or duplicate a Notion page.
    if(s.action==='existing'){
      await rpc(db,'individual_room_slot_record',{p_run:runId,p_date:s.date,p_start:s.start,p_room:s.room,p_hash:hash,p_page:s.pageId,p_status:'existing'});result.existing++;writes++;continue;
    }
    if(result.created>=maxCreates||clock()>deadline-35000){result.pending++;continue;}
    // Refresh the target room and all unassigned campus uses, including long events.
    const common={property:fields.date.id,date:{on_or_before:`${s.date}T23:59:59+09:00`}};
    const relevant={or:[{property:fields.date.id,date:{on_or_after:`${s.date}T00:00:00+09:00`}},{property:fields.tags.id,multi_select:{does_not_contain:'個別使用可能'}}]};
    const notTeacherAvailability={property:fields.tags.id,multi_select:{does_not_contain:'本：予約可'}};
    const roomPages=await queryPages(request,BENSUKE_SOURCE_ID,{and:[common,{property:fields.room.id,select:{equals:s.room}},relevant,notTeacherAvailability]},50);
    const unassigned=await queryPages(request,BENSUKE_SOURCE_ID,{and:[common,{property:fields.campuses.id,multi_select:{contains:'本校'}},{property:fields.room.id,select:{is_empty:true}},relevant,notTeacherAvailability]},50);
    const current=classifyIndividualSlot(s,[...new Map([...roomPages,...unassigned].map(p=>[p.id,p])).values()],prepared.schema);
    const args={p_run:runId,p_date:s.date,p_start:s.start,p_room:s.room,p_hash:hash};
    if(current.action==='existing'){
      await rpc(db,'individual_room_slot_record',{...args,p_page:current.pageId,p_status:'existing'});result.existing++;writes++;continue;
    }
    if(current.action!=='create'){
      result[current.action]++;if(current.action==='review'&&result.details.length<60)result.details.push({date:s.date,start:s.start,room:s.room,reason:current.reason});continue;
    }
    if(s.record?.status==='uncertain'){result.review++;continue;}
    await assertSource();await renew();
    if(clock()>deadline-35000){result.pending++;continue;}
    const claim=await rpc(db,'individual_room_slot_claim',args);
    if(!claim?.acquired){result[claim?.notion_page_id?'recorded':'review']++;continue;}
    writes++;
    // From this point, any unknown POST outcome remains durably uncertain.
    const value=slotValue(s);
    const created=await request('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:BENSUKE_SOURCE_ID},properties:scheduleProperties(value,prepared.schema),icon:{type:'icon',icon:{name:'burst',color:'red'}}})});
    if(created.parent?.data_source_id!==BENSUKE_SOURCE_ID||!equivalentSchedule(scheduleValue(created,prepared.schema),value))throw Error('個別枠の作成結果を確認できません。再作成せず次回照合します。');
    await rpc(db,'individual_room_slot_record',{...args,p_page:created.id,p_status:'created'});result.created++;
  }
  return result;
}
