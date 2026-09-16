import {InterviewError,normalizeTeacher,validateAppointment,defaults} from './interview-core.mjs';
import {bensukeAvailability} from './bensuke-reader.mjs';

export const BENSUKE_SOURCE='19ef0120-80a7-80c4-a965-000b104ea319';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=a=>(a??[]).map(x=>x.plain_text??x.text?.content??'').join('');
const teacherKey=name=>normalizeTeacher(name).replace(/(?:先生|さん)$/u,'');
const sameId=(a,b)=>String(a).replaceAll('-','')===String(b).replaceAll('-','');
const fields={title:['名前','title'],date:['日時','date'],teachers:['担当者','relation'],campuses:['校舎','multi_select'],room:['教室','select'],tags:['内容','multi_select']};
export function bookingSchema(schema){
 const result={};
 for(const [key,[name,type]] of Object.entries(fields)){
  const p=schema.properties?.[name];
  if(!p||p.type!==type)throw new InterviewError(`ベンスケの「${name}」の項目・接続を確認してください。`,503);
  result[key]={...p,name};
 }
 if(!result.teachers.relation?.data_source_id)throw new InterviewError('職員DBの接続を確認してください。',503);
 return result;
}
export function scheduleValue(page,schema){
 const p=bookingSchema(schema),get=k=>Object.values(page.properties??{}).find(v=>v.id===p[k].id)??page.properties?.[p[k].name];
 for(const key of Object.keys(fields))if(!get(key)||get(key).has_more)throw new InterviewError('ベンスケの項目を全件取得できません。Notionで確認してください。',503);
 return {title:text(get('title').title),date:get('date').date,teachers:get('teachers').relation.map(x=>x.id).sort(),campuses:get('campuses').multi_select.map(x=>x.name).sort(),room:get('room').select?.name??'',tags:get('tags').multi_select.map(x=>x.name).sort()};
}
export async function queryPages(request,sourceId,filter){
 let cursor;const seen=new Set(),rows=[];
 do{
  const page=await request(`/data_sources/${sourceId}/query`,{method:'POST',body:JSON.stringify({page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})})});
  if(!Array.isArray(page.results))throw new InterviewError('Notionの取得結果を確認できません。',503);
  rows.push(...page.results.filter(p=>!p.archived&&!p.in_trash));
  if(page.has_more&&(!page.next_cursor||seen.has(page.next_cursor)||seen.size>=19))throw new InterviewError('Notionの全予定を確認できません。確定を停止しました。',503);
  cursor=page.has_more?page.next_cursor:null;if(cursor)seen.add(cursor);
 }while(cursor);
 return rows;
}
export async function staffDirectory(request,schema){
 const sourceId=bookingSchema(schema).teachers.relation.data_source_id;
 const pages=await queryPages(request,sourceId);
 return pages.map(p=>({id:p.id,name:text(Object.values(p.properties??{}).find(v=>v.type==='title')?.title)})).filter(p=>p.name);
}
export function teacherMatch(name,directory){
 const matches=directory.filter(p=>teacherKey(p.name)===teacherKey(name));
 if(matches.length!==1)throw new InterviewError(`担当講師「${name}」と職員DBを一意に対応できません。職員DBの名前・重複を確認してください。`,409);
 return matches[0];
}
export async function checkedPage(request,pageId,sourceId){
 if(!uuid.test(pageId))throw new InterviewError('ベンスケのカードを選び直してください。');
 const page=await request(`/pages/${pageId}`);
 if(!sameId(page.parent?.data_source_id,sourceId))throw new InterviewError('別のDBのカードは使用できません。',409);
 if(page.archived||page.in_trash)throw new InterviewError('Notion側でカードが削除されています。確認してください。',409);
 return page;
}
function asAvailability(page,schema){
 const p=bookingSchema(schema),properties={};
 for(const [key,[name]] of Object.entries(fields))properties[name]=Object.values(page.properties).find(v=>v.id===p[key].id)??page.properties[name];
 return bensukeAvailability({...page,properties});
}
export async function prepareBinding({request,sourceId=BENSUKE_SOURCE,pageId,editedAt,data}){
 const schema=await request(`/data_sources/${sourceId}`),page=await checkedPage(request,pageId,sourceId);
 if(page.last_edited_time!==editedAt)throw new InterviewError('ベンスケの枠が変更されました。再取得して選び直してください。',409);
 const slot=asAvailability(page,schema);
 if(!slot?.usable)throw new InterviewError('このカードは面談に使える予約可ではありません。',409);
 for(const key of ['date','start','end','campus','room'])if(slot[key]!==data[key])throw new InterviewError('選択した予約可の日時・校舎・教室を変更せず登録してください。',409);
 const teacher=teacherMatch(data.teacher,await staffDirectory(request,schema)),baseline=scheduleValue(page,schema);
 if(baseline.teachers.length&&!baseline.teachers.includes(teacher.id))throw new InterviewError('予約可に設定された担当者と一致しません。',409);
 await checkNotionConflicts({request,sourceId,schema,data,teacherId:teacher.id,excludeId:pageId});
 return {pageId,sourceId,editedAt,baseline};
}
export function desiredSchedule(booking,teacherId){
 const d=booking.data;
 if(['cancelled','rejected'].includes(booking.status))return booking.notion_original;
 const mode=d.method==='対面'?'対面':d.method==='電話'?'電話':'オンライン';
 const room=d.room?`${d.campus==='本校'?'本':'南'}${'①②③④⑤⑥⑦⑧⑨'[Number(d.room)-1]??''}`:'';
 if(d.room&&(Number(d.room)>9||!Number(d.room)))throw new InterviewError('ベンスケに対応する教室がありません。');
 return {title:`面談：${d.studentName}（${mode}）`,date:{start:`${d.date}T${d.start}:00+09:00`,end:`${d.date}T${d.end}:00+09:00`,time_zone:null},teachers:[teacherId],campuses:[d.campus],room,tags:[mode==='電話'?'電話':`面談(${mode})`]};
}
export function scheduleProperties(value,schema){
 const p=bookingSchema(schema),option=(key,name)=>{
  const match=p[key][p[key].type].options.find(o=>o.name===name);
  if(!match)throw new InterviewError(`ベンスケの「${p[key].name}」に「${name}」がありません。`,409);
  return {id:match.id};
 };
 return {[p.title.id]:{title:[{text:{content:value.title}}]},[p.date.id]:{date:value.date},[p.teachers.id]:{relation:value.teachers.map(id=>({id}))},[p.campuses.id]:{multi_select:value.campuses.map(n=>option('campuses',n))},[p.room.id]:{select:value.room?option('room',value.room):null},[p.tags.id]:{multi_select:value.tags.map(n=>option('tags',n))}};
}
// Compare normalized instants: Notion may return +09:00 values in UTC.
export function equivalentSchedule(a,b){
 const canon=v=>v?{title:v.title,room:v.room,date:v.date?{start:new Date(v.date.start).toISOString(),end:v.date.end?new Date(v.date.end).toISOString():null}:null,teachers:[...v.teachers].sort(),campuses:[...v.campuses].sort(),tags:[...v.tags].sort()}:v;
 return JSON.stringify(canon(a))===JSON.stringify(canon(b));
}
export function assertNoNotionConflicts(rows,{schema,data,teacherId,excludeId}){
 const start=Date.parse(`${data.date}T${data.busyStart}:00+09:00`),end=Date.parse(`${data.date}T${data.busyEnd}:00+09:00`);
 for(const page of rows){
  if(sameId(page.id,excludeId))continue;
  const v=scheduleValue(page,schema);
  if(v.tags.length===1&&['本：予約可','南：予約可'].includes(v.tags[0]))continue;
  const resource=v.teachers.includes(teacherId)||(v.campuses.includes(data.campus)&&((v.tags.includes('休み')&&!v.teachers.length)||(data.room&&v.room===`${data.campus==='本校'?'本':'南'}${'①②③④⑤⑥⑦⑧⑨'[Number(data.room)-1]}`)));
  if(!resource)continue;
  // Unscheduled cards have no interval to compare. The confirmation UI requires
  // the operator to review those separately; do not treat them as timed bookings.
  if(!v.date?.start)continue;
  const timed=v.date.start.includes('T');
  const a=Date.parse(timed?v.date.start:`${v.date.start}T00:00:00+09:00`);
  let b=v.date.end?Date.parse(v.date.end.includes('T')?v.date.end:`${v.date.end}T00:00:00+09:00`)+(v.date.end.includes('T')?0:86400000):Date.parse(`${new Date(a+9*3600000).toISOString().slice(0,10)}T23:59:59+09:00`)+1000;
  if(v.tags.some(t=>t.startsWith('面談'))&&v.date.end?.includes('T'))b+=15*60000;
  if(!Number.isFinite(a)||!Number.isFinite(b))throw new InterviewError('既存予定の終了時刻を確認できません。',409);
  // Zero-length historical entries must not block every future day. Treat an
  // absent/invalid end as occupying the rest of its own start day.
  if(b<=a)b=Date.parse(`${new Date(a+9*3600000).toISOString().slice(0,10)}T23:59:59+09:00`)+1000;
  if(a<end&&start<b)throw new InterviewError('Notionの既存予定と担当講師または教室が重なります。',409);
 }
}
export async function checkNotionConflicts({request,sourceId,schema,data,teacherId,excludeId}){
 const p=bookingSchema(schema);
 const resource=[{property:p.teachers.id,relation:{contains:teacherId}}];
 if(data.room)resource.push({and:[{property:p.campuses.id,multi_select:{contains:data.campus}},{property:p.room.id,select:{equals:`${data.campus==='本校'?'本':'南'}${'①②③④⑤⑥⑦⑧⑨'[Number(data.room)-1]}`}}]});
 // Keep arbitrary-length events in the query; a lower start-date bound would miss them.
 // School closures have no assignee/room and must still be included.
 resource.push({and:[{property:p.campuses.id,multi_select:{contains:data.campus}},{property:p.tags.id,multi_select:{contains:'休み'}},{property:p.teachers.id,relation:{is_empty:true}}]});
 // Split resource queries to stay within Notion's two-level compound-filter limit.
 const rows=new Map();
 for(const r of resource){
  const pages=await queryPages(request,sourceId,{and:[{property:p.date.id,date:{on_or_before:`${data.date}T23:59:59+09:00`}},...('and' in r?r.and:[r])]});
  for(const page of pages)rows.set(page.id,page);
 }
 assertNoNotionConflicts([...rows.values()],{schema,data,teacherId,excludeId});
}
export function remoteAppointment(booking,value,directory,settings=defaults){
 if(value.teachers.length!==1||value.campuses.length!==1||!value.date?.end||!value.date.start.includes('T')||!value.date.end.includes('T'))throw new InterviewError('Notionの日時・担当者・校舎を一つに確定してください。',409);
 const person=directory.find(x=>x.id===value.teachers[0]);if(!person)throw new InterviewError('Notionの担当者を確認できません。',409);
 const start=new Date(Date.parse(value.date.start)+9*3600000).toISOString(),end=new Date(Date.parse(value.date.end)+9*3600000).toISOString();
 const room=value.room?String('①②③④⑤⑥⑦⑧⑨'.indexOf(value.room.slice(1))+1):'';
 if(value.room&&(value.room!==`${value.campuses[0]==='本校'?'本':'南'}${'①②③④⑤⑥⑦⑧⑨'[Number(room)-1]}`||room==='0'))throw new InterviewError('Notionの教室を対応付けできません。',409);
 const candidate=validateAppointment({...booking.data,date:start.slice(0,10),start:start.slice(11,16),teacher:teacherKey(person.name),campus:value.campuses[0],room},settings);
 if(end.slice(0,10)!==candidate.date||end.slice(11,16)!==candidate.end)throw new InterviewError('Notionの面談時間が予約設定と一致しません。',409);
 const expected=desiredSchedule({...booking,data:{...booking.data,...candidate}},person.id);
 if(value.title!==expected.title||JSON.stringify(value.tags)!==JSON.stringify(expected.tags))throw new InterviewError('氏名・方法・用途が変更されています。Notionで内容を確認してください。',409);
 return {...booking.data,...candidate};
}
