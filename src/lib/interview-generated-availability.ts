import 'server-only';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {InterviewError,normalizeTeacher,validateAppointment} from './interview-core.mjs';
import {CampusChoiceNeeded,planTeacherAvailability,resolveAvailabilityTeacher,resolveDayCampus} from './bensuke-availability-auto.mjs';
import {BENSUKE_SOURCE,assertNoNotionConflicts,bookingSchema,equivalentSchedule,queryPages,scheduleProperties,scheduleValue,staffDirectory,teacherMatch} from './bensuke-booking.mjs';
import {bensukeRequest} from './interview-sync';
import {readAll} from './interview-store';
import {scheduleSyncMonths} from './schedule-sync.mjs';

// Supabase and Notion return dynamic JSON; each field used below is validated by the domain helpers.
type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Lesson={lesson_date:string;teacher_name?:string;campus?:string;start_time?:string};
type Booking={status:string;data?:Record<string,string>};
type Action='create'|'update'|'archive'|'keep'|'skip'|'review';
export type AvailabilityItem={key:string;date:string;start:string;end:string;campus:string;action:Action;reason:string;needsCampusChoice?:boolean;pageId?:string;notionEditedAt?:string;expected?:Row};
type CampusDecision={date:string;campus:string;lessonHash:string;source:'selected'|'saved'};
export type AvailabilityPreview={month:string;teacher:string;items:AvailabilityItem[];summary:Record<Action,number>;hash:string;lessonDays:number;campusDecisions:CampusDecision[]};
export type AvailabilityActor={staffCode:string;displayName:string};
export type AvailabilityOverview={month:string;teachers:Array<{teacher:string;status:'not-run'|'applied'|'review';lessonDays:number;activeSlots:number;reviewCount:number;finishedAt:string|null}>};
const pageKey=(value:string)=>String(value??'').replaceAll('-','').toLowerCase();
const teacherKey=(value:unknown)=>normalizeTeacher(value).replace(/(?:先生|さん)$/u,'');
const lessonHash=(rows:Row[])=>createHash('sha256').update(JSON.stringify(rows.map(row=>[row.lesson_date,row.campus,row.start_time,row.grade,row.class_name,row.subject,row.label,row.source_key].map(value=>String(value??'').normalize('NFKC'))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
function checkCampusChoices(month:string,value:unknown):Record<string,string>{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>31)throw new InterviewError('校舎の選択を確認してください。');
 const choices=value as Record<string,unknown>;for(const [date,campus] of Object.entries(choices))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!date.startsWith(`${month}-`)||!['本校','南教室'].includes(String(campus)))throw new InterviewError('校舎の選択を確認してください。');
 return choices as Record<string,string>;
}
const monthEnd=(month:string)=>{const [year,n]=month.split('-').map(Number);return new Date(Date.UTC(year,n,1)).toISOString().slice(0,10);};
const lastDay=(month:string)=>{const [year,n]=month.split('-').map(Number);return new Date(Date.UTC(year,n,0)).toISOString().slice(0,10);};
function checkMonth(month:string){if(!/^\d{4}-\d{2}$/.test(month)||!scheduleSyncMonths().includes(month))throw new InterviewError('予約可を作成できるのは今月と翌月です。',422);}
const managedKey=(date:string,start:string)=>`${date}|${start}`;
const instant=(date:string,time:string)=>new Date(`${date}T${time}:00+09:00`).toISOString();
const sameSlot=(value:Row,row:Row,staffId:string)=>value.teachers?.length===1&&value.teachers[0]===staffId&&value.date?.start&&value.date?.end&&new Date(value.date.start).toISOString()===instant(row.date,row.start)&&new Date(value.date.end).toISOString()===instant(row.date,row.end)&&value.campuses?.length===1&&value.campuses[0]===row.campus&&value.tags?.length===1&&['本：予約可','南：予約可'].includes(value.tags[0]);
function desiredValue(row:Row,staffId:string){const prefix=row.campus==='本校'?'本':'南';return {title:`${prefix}：${row.teacher}予約可`,date:{start:`${row.date}T${row.start}:00+09:00`,end:`${row.date}T${row.end}:00+09:00`,time_zone:null},teachers:[staffId],campuses:[row.campus],room:'',tags:[`${prefix}：予約可`]};}
async function monthRows(db:SupabaseClient,table:string,column:string,from:string,to:string){
 const rows:Row[]=[];for(let offset=0;offset<5000;offset+=500){const result=await db.from(table).select('*').gte(column,from).lt(column,to).range(offset,offset+499);if(result.error)throw new InterviewError('予約可の管理情報を読み込めません。',503);rows.push(...(result.data??[]));if((result.data?.length??0)<500)return rows;}throw new InterviewError('対象月のデータが多すぎます。',503);
}
export async function previewGeneratedAvailability(db:SupabaseClient,month:string,actor:AvailabilityActor,choiceInput?:unknown):Promise<AvailabilityPreview>{
 checkMonth(month);const campusChoices=checkCampusChoices(month,choiceInput);
 const from=`${month}-01`,to=monthEnd(month);
 const [lessons,managed,runs,bookings,publicSlots,invitations,requests,schema]=await Promise.all([
  monthRows(db,'lessons','lesson_date',from,to),monthRows(db,'interview_generated_availability','slot_date',from,to),monthRows(db,'interview_availability_runs','target_month',from,to),readAll(db,'interview_bookings'),readAll(db,'interview_public_slots'),readAll(db,'interview_invitations'),readAll(db,'interview_parent_requests'),bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`),
 ]);
 const settingsResult=await db.from('interview_settings').select('data').eq('id',true).single();if(settingsResult.error)throw new InterviewError('面談時間の設定を読み込めません。',503);const settings=(settingsResult.data as Row).data;
 const directory=await staffDirectory(bensukeRequest,schema);
 let teacher:string;try{const lessonCandidates=lessons.map((row:Row)=>row.teacher_name).filter(Boolean);teacher=resolveAvailabilityTeacher({displayName:actor.displayName,staffCode:actor.staffCode,candidates:lessonCandidates.length?lessonCandidates:directory.map((row:{name:string})=>row.name)});}catch(error){throw new InterviewError(error instanceof Error?error.message:'担当する先生を特定できません。',422);}
 const staff=teacherMatch(teacher,directory),property:any=bookingSchema(schema); // eslint-disable-line @typescript-eslint/no-explicit-any
 const pages:Row[]=await queryPages(bensukeRequest,BENSUKE_SOURCE,{and:[{property:property.date.id,date:{on_or_after:from}},{property:property.date.id,date:{on_or_before:lastDay(month)}}]}) as Row[];
 const conflictMap=new Map<string,Row>(pages.map(page=>[pageKey(page.id),page]));
 const teacherPages:Row[]=await queryPages(bensukeRequest,BENSUKE_SOURCE,{and:[{property:property.date.id,date:{on_or_before:lastDay(month)}},{property:property.teachers.id,relation:{contains:staff.id}}]}) as Row[];
 for(const page of teacherPages)conflictMap.set(pageKey(page.id),page);
 for(const campus of ['本校','南教室']){
  const closures:Row[]=await queryPages(bensukeRequest,BENSUKE_SOURCE,{and:[{property:property.date.id,date:{on_or_before:lastDay(month)}},{property:property.campuses.id,multi_select:{contains:campus}},{property:property.tags.id,multi_select:{contains:'休み'}},{property:property.teachers.id,relation:{is_empty:true}}]}) as Row[];
  for(const page of closures)conflictMap.set(pageKey(page.id),page);
 }
 const conflictPages=[...conflictMap.values()];
 const cards=pages.map((page:Row)=>({page,value:scheduleValue(page,schema)})),byPage=new Map(cards.map(card=>[pageKey(card.page.id),card]));
 const publicById=new Map<string,Row>(publicSlots.map((slot:Row)=>[String(slot.id),slot])),protectedPages=new Set<string>();
 for(const slot of publicSlots as Row[])if(slot.published)protectedPages.add(pageKey(slot.notion_page_id));
 for(const booking of bookings as Row[])if(booking.notion_page_id)protectedPages.add(pageKey(booking.notion_page_id));
 for(const invitation of invitations as Row[])for(const choice of Array.isArray(invitation.slots)?invitation.slots:[]){const slot=publicById.get(String(choice.id));if(slot?.notion_page_id)protectedPages.add(pageKey(slot.notion_page_id));}
 for(const request of requests as Row[])for(const choice of Array.isArray(request.choices)?request.choices:[]){const slot=publicById.get(String(choice.slotId));if(slot?.notion_page_id)protectedPages.add(pageKey(slot.notion_page_id));}
 const relevantBookings=bookings.filter((row:Row)=>row.data?.date>=from&&row.data?.date<to),desired=new Map<string,Row>(),items:AvailabilityItem[]=[],reviewDates=new Set<string>(),campusDecisions:CampusDecision[]=[];
 const savedDecisions=new Map<string,CampusDecision>();for(const run of runs.filter((row:Row)=>row.status==='applied'&&teacherKey(row.result?.teacher)===teacherKey(teacher)).sort((a:Row,b:Row)=>String(b.created_at).localeCompare(String(a.created_at))))for(const decision of Array.isArray(run.result?.campusDecisions)?run.result.campusDecisions:[])if(!savedDecisions.has(decision.date))savedDecisions.set(decision.date,decision);
 const lessonDates=[...new Set<string>(lessons.filter((row:Row)=>teacherKey(row.teacher_name)===teacherKey(teacher)).map((row:Row)=>String(row.lesson_date)))].sort();
 for(const date of lessonDates){
  try{
   const dayLessons=lessons.filter((row:Row)=>String(row.lesson_date)===date&&teacherKey(row.teacher_name)===teacherKey(teacher));
   const fingerprint=lessonHash(dayLessons),saved=savedDecisions.get(date),selected=campusChoices[date];
   let choice='';try{resolveDayCampus(dayLessons);}catch(error){if(!(error instanceof CampusChoiceNeeded))throw error;choice=selected??(saved?.lessonHash===fingerprint?saved.campus:'');}
   for(const planned of planTeacherAvailability({date,teacher,lessons:lessons as Lesson[],bookings:relevantBookings as Booking[],settings,campusChoice:choice})){
    const data=validateAppointment({...planned,studentId:'00000000-0000-4000-8000-000000000000',method:'Zoom',purpose:'保護者面談',participants:'保護者',channel:'職員入力',note:'',room:''},settings);
    desired.set(managedKey(date,planned.start),{...data,campus:planned.campus,teacher});
   }
   if(choice)campusDecisions.push({date,campus:choice,lessonHash:fingerprint,source:selected?'selected':'saved'});
  }catch(error){reviewDates.add(date);items.push({key:`${date}|review`,date,start:'',end:'',campus:'',action:'review',needsCampusChoice:error instanceof CampusChoiceNeeded,reason:error instanceof Error?error.message:'勤務校舎を確認してください。'});}
 }
 const managedMap=new Map(managed.filter((row:Row)=>teacherKey(row.teacher)===teacherKey(teacher)).map((row:Row)=>[managedKey(row.slot_date,row.start_time),row]));
 if(!lessonDates.length&&managedMap.size){for(const date of [...new Set<string>([...managedMap.values()].filter((row:Row)=>row.status==='active').map((row:Row)=>String(row.slot_date)))]){reviewDates.add(date);items.push({key:`${date}|missing-lessons`,date,start:'',end:'',campus:'',action:'review',reason:`この月の${teacher}先生の授業を読み取れないため、既存枠を削除しません。`});}}
 for(const [key,row] of desired){
  const tracked=managedMap.get(key),expected=desiredValue(row,staff.id),card=tracked?.notion_page_id?byPage.get(pageKey(tracked.notion_page_id)):undefined;
  if(tracked?.status==='active'){
   if(!card){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'review',reason:'自動作成したNotionカードが見つかりません。',pageId:tracked.notion_page_id});continue;}
   if(!equivalentSchedule(card.value,tracked.expected)){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'review',reason:'自動作成後にNotionで変更されています。',pageId:card.page.id});continue;}
   if(equivalentSchedule(card.value,expected)){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'keep',reason:'変更なし',pageId:card.page.id,notionEditedAt:card.page.last_edited_time,expected});continue;}
   if(protectedPages.has(pageKey(card.page.id))){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'review',reason:'公開・打診・予約で使用中のため変更しません。',pageId:card.page.id});continue;}
   items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'update',reason:'授業表の変更に合わせて更新',pageId:card.page.id,notionEditedAt:card.page.last_edited_time,expected});continue;
  }
  if(tracked&&card){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'review',reason:'削除済みとして記録したカードがNotionで復元されています。',pageId:card.page.id});continue;}
  const manual=cards.find(({page,value})=>!managed.some((m:Row)=>pageKey(m.notion_page_id)===pageKey(page.id))&&sameSlot(value,row,staff.id));
  if(manual){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'skip',reason:'同じ時刻の手動予約可があります。'});continue;}
  try{assertNoNotionConflicts(conflictPages,{schema,data:row,teacherId:staff.id,excludeId:''});}
  catch(error){items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'skip',reason:error instanceof Error?error.message:'既存予定と重なります。'});continue;}
  items.push({key,date:row.date,start:row.start,end:row.end,campus:row.campus,action:'create',reason:'新しく作成',expected});
 }
 for(const tracked of managed.filter((row:Row)=>teacherKey(row.teacher)===teacherKey(teacher)&&row.status==='active')){
  const key=managedKey(tracked.slot_date,tracked.start_time);if(desired.has(key)||reviewDates.has(tracked.slot_date))continue;const card=byPage.get(pageKey(tracked.notion_page_id));
  if(!card){items.push({key,date:tracked.slot_date,start:tracked.start_time,end:'',campus:tracked.campus,action:'review',reason:'自動作成したNotionカードが見つかりません。',pageId:tracked.notion_page_id});continue;}
  if(!equivalentSchedule(card.value,tracked.expected)){items.push({key,date:tracked.slot_date,start:tracked.start_time,end:card.value.date?.end?new Date(card.value.date.end).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'',campus:tracked.campus,action:'review',reason:'自動作成後にNotionで変更されています。',pageId:card.page.id});continue;}
  if(protectedPages.has(pageKey(card.page.id))){items.push({key,date:tracked.slot_date,start:tracked.start_time,end:'',campus:tracked.campus,action:'review',reason:'公開・打診・予約で使用中のため削除しません。',pageId:card.page.id});continue;}
  items.push({key,date:tracked.slot_date,start:tracked.start_time,end:card.value.date?.end?new Date(card.value.date.end).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'',campus:tracked.campus,action:'archive',reason:'最新の授業表では不要',pageId:card.page.id,notionEditedAt:card.page.last_edited_time,expected:tracked.expected});
 }
 items.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.action.localeCompare(b.action));
 const summary={create:0,update:0,archive:0,keep:0,skip:0,review:0};for(const item of items)summary[item.action]++;
 const sourceHash=lessonHash(lessons.filter((row:Row)=>teacherKey(row.teacher_name)===teacherKey(teacher)));
 const hash=createHash('sha256').update(JSON.stringify({month,teacher,sourceHash,campusDecisions,items})).digest('hex');return {month,teacher,items,summary,hash,lessonDays:lessonDates.length,campusDecisions};
}

export async function availabilityOverview(db:SupabaseClient,month:string):Promise<AvailabilityOverview>{
 checkMonth(month);const from=`${month}-01`,to=monthEnd(month);
 const [lessons,managed,runsResult]=await Promise.all([monthRows(db,'lessons','lesson_date',from,to),monthRows(db,'interview_generated_availability','slot_date',from,to),db.from('interview_availability_runs').select('status,result,finished_at,created_at').eq('target_month',from).order('created_at',{ascending:false})]);
 if(runsResult.error)throw new InterviewError('先生別の実行状況を読み込めません。',503);
 const names=new Map<string,string>();for(const row of [...lessons,...managed]){const value=String(row.teacher_name??row.teacher??'').trim();if(value)names.set(teacherKey(value),teacherKey(value));}
 const latest=new Map<string,Row>();for(const run of runsResult.data??[]){const key=teacherKey(run.result?.teacher);if(key&&!latest.has(key))latest.set(key,run);}
 return {month,teachers:[...names.values()].sort((a,b)=>a.localeCompare(b,'ja')).map(teacher=>{const key=teacherKey(teacher),run=latest.get(key),reviewCount=Number(run?.result?.summary?.review??0);return {teacher,status:!run?'not-run':run.status==='applied'&&!reviewCount?'applied':'review',lessonDays:new Set(lessons.filter(row=>teacherKey(row.teacher_name)===key).map(row=>row.lesson_date)).size,activeSlots:managed.filter(row=>teacherKey(row.teacher)===key&&row.status==='active').length,reviewCount,finishedAt:run?.finished_at??null};})};
}

export async function applyGeneratedAvailability(db:SupabaseClient,input:{month:string;identity:AvailabilityActor;previewHash:string;operationKey:string;actor:string;campusChoices?:unknown}){
 const {month,identity,previewHash,operationKey,actor,campusChoices}=input;if(!/^[0-9a-f-]{36}$/i.test(operationKey)||!/^[0-9a-f-]{36}$/i.test(actor))throw new InterviewError('操作をやり直してください。');
 const prior=await db.from('interview_availability_runs').select('*').eq('operation_key',operationKey).maybeSingle();if(prior.error)throw new InterviewError('実行履歴を確認できません。',503);
 if(prior.data){if(prior.data.status==='applied')return prior.data.result;throw new InterviewError('前回の反映結果を確認してから、もう一度プレビューしてください。',409);}
 const preview=await previewGeneratedAvailability(db,month,identity,campusChoices),teacher=preview.teacher;if(preview.hash!==previewHash)throw new InterviewError('授業表または予定が更新されました。もう一度確認してください。',409);
 const claim=await db.from('interview_availability_runs').insert({operation_key:operationKey,actor,target_month:`${month}-01`,preview_hash:previewHash,status:'applying'});if(claim.error)throw new InterviewError('別の反映処理を確認してください。',409);
 const schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`),results:Row[]=[];
 try{
  for(const item of preview.items.filter(row=>['create','update','archive'].includes(row.action))){
   if(item.action==='archive'){
    const page=await bensukeRequest(`/pages/${item.pageId}`);if(page.last_edited_time!==item.notionEditedAt)throw new InterviewError(`${item.date} ${item.start}のカードが変更されました。再確認してください。`,409);
    await bensukeRequest(`/pages/${item.pageId}`,{method:'PATCH',body:JSON.stringify({archived:true})});
    const saved=await db.from('interview_generated_availability').update({status:'archived',updated_at:new Date().toISOString()}).eq('notion_page_id',item.pageId);if(saved.error)throw saved.error;results.push({action:'archive',date:item.date,start:item.start});continue;
   }
   const properties=scheduleProperties(item.expected,schema);let page;
   if(item.action==='update'){
    const current=await bensukeRequest(`/pages/${item.pageId}`);if(current.last_edited_time!==item.notionEditedAt)throw new InterviewError(`${item.date} ${item.start}のカードが変更されました。再確認してください。`,409);
    page=await bensukeRequest(`/pages/${item.pageId}`,{method:'PATCH',body:JSON.stringify({properties})});
   }else page=await bensukeRequest('/pages',{method:'POST',body:JSON.stringify({parent:{type:'data_source_id',data_source_id:BENSUKE_SOURCE},properties})});
   const saved=await db.from('interview_generated_availability').upsert({teacher,slot_date:item.date,start_time:item.start,campus:item.campus,notion_page_id:page.id,expected:item.expected,notion_edited_at:page.last_edited_time,status:'active',updated_at:new Date().toISOString()},{onConflict:'teacher,slot_date,start_time'});if(saved.error)throw saved.error;results.push({action:item.action,date:item.date,start:item.start});
  }
  const result={month,teacher,summary:preview.summary,campusDecisions:preview.campusDecisions,applied:results};const finished=await db.from('interview_availability_runs').update({status:'applied',result,finished_at:new Date().toISOString()}).eq('operation_key',operationKey);if(finished.error)throw finished.error;return result;
 }catch(error){await db.from('interview_availability_runs').update({status:'failed',result:{teacher,message:error instanceof Error?error.message:'反映に失敗しました。'},finished_at:new Date().toISOString()}).eq('operation_key',operationKey);throw error instanceof InterviewError?error:new InterviewError('一部の反映結果を再確認してください。もう一度プレビューしてください。',503);}
}
