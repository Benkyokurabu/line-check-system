import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {InterviewError,normalizeTeacher} from './interview-core.mjs';
import {resolveAvailabilityTeacher} from './bensuke-availability-auto.mjs';
import {BENSUKE_SOURCE,bookingSchema,queryPages,scheduleValue,staffDirectory,teacherMatch} from './bensuke-booking.mjs';
import {bensukeAvailability} from './bensuke-reader.mjs';
import {bensukeRequest} from './interview-sync';
import {readAll} from './interview-store';
import {scheduleSyncMonths} from './schedule-sync.mjs';
import {archiveBlockReason} from './interview-availability-archive.mjs';

type Actor={staffId:string;staffCode:string;displayName:string};
type Row=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key=(value:unknown)=>String(value??'').replaceAll('-','').toLowerCase();
const teacherKey=(value:unknown)=>normalizeTeacher(value).replace(/(?:先生|さん)$/u,'');

async function ownTeacher(actor:Actor){
 const schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`);
 const directory=await staffDirectory(bensukeRequest,schema);
 let name:string;
 try{name=resolveAvailabilityTeacher({displayName:actor.displayName,staffCode:actor.staffCode,candidates:directory.map((row:{name:string})=>row.name)});}
 catch(error){throw new InterviewError(error instanceof Error?error.message:'先生を特定できません。',422);}
 return {schema,teacher:teacherMatch(name,directory),name};
}

export async function listOwnAvailability(month:string,actor:Actor){
 if(!/^\d{4}-\d{2}$/.test(month)||!scheduleSyncMonths().includes(month))throw new InterviewError('今月または翌月を選んでください。',422);
 const {schema,teacher,name}=await ownTeacher(actor),properties=bookingSchema(schema) as {date:{id:string};teachers:{id:string}};
 const [year,n]=month.split('-').map(Number),last=new Date(Date.UTC(year,n,0)).toISOString().slice(0,10);
 const pages=await queryPages(bensukeRequest,BENSUKE_SOURCE,{and:[
  {property:properties.date.id,date:{on_or_after:`${month}-01`}},
  {property:properties.date.id,date:{on_or_before:last}},
  {property:properties.teachers.id,relation:{contains:teacher.id}},
 ]});
 const rows=pages.flatMap((page:Row)=>{
  const availability=bensukeAvailability(page);
  if(!availability?.usable)return [];
  const value=scheduleValue(page,schema);
  if(value.teachers.length!==1||key(value.teachers[0])!==key(teacher.id))return [];
  return [{pageId:page.id,editedAt:page.last_edited_time,...availability,teacher:name}];
 }).sort((a:Row,b:Row)=>String(a.date).localeCompare(String(b.date))||String(a.start).localeCompare(String(b.start)));
 return {teacher:name,rows};
}

export async function archiveOwnAvailability(db:SupabaseClient,actor:Actor,pageId:string,editedAt:string,operationKey:string){
 if(!uuid.test(pageId)||!uuid.test(operationKey)||!editedAt)throw new InterviewError('予約可を選び直してください。',422);
 const event=await db.from('interview_request_events').select('actor,action,payload,result').eq('operation_key',operationKey).maybeSingle();
 if(event.error)throw new InterviewError('削除履歴を確認できません。',503);
 if(event.data){
  if(event.data.actor!==`staff:${actor.staffId}`||event.data.action!=='archive_availability'||event.data.payload?.pageId!==pageId)throw new InterviewError('操作番号が重複しています。',409);
  return event.data.result;
 }
 const {schema,teacher}=await ownTeacher(actor);
 const page=await bensukeRequest(`/pages/${pageId}`);
 if(key(page.parent?.data_source_id)!==key(BENSUKE_SOURCE))throw new InterviewError('別のDBのカードは削除できません。',409);
 if(!page.archived&&!page.in_trash&&page.last_edited_time!==editedAt)throw new InterviewError('Notionの予約可が変更されました。再読み込みして確認してください。',409);
 const availability=bensukeAvailability({...page,archived:false,in_trash:false}),value=scheduleValue(page,schema);
 if(!availability?.usable||value.tags.length!==1||!['本：予約可','南：予約可'].includes(value.tags[0])||value.teachers.length!==1||key(value.teachers[0])!==key(teacher.id))throw new InterviewError('自分の予約可だけを削除できます。',403);
 const slotData=availability as {date:string;start:string;campus:string};
 if(!scheduleSyncMonths().includes(slotData.date.slice(0,7)))throw new InterviewError('今月または翌月の予約可を選んでください。',422);
 const [slots,bookings,requests,invitations]=await Promise.all([
  readAll(db,'interview_public_slots'),readAll(db,'interview_bookings'),readAll(db,'interview_parent_requests'),readAll(db,'interview_invitations'),
 ]);
 const slot=slots.find((row:Row)=>key(row.notion_page_id)===key(pageId));
 const blocked=archiveBlockReason({pageId,slot,bookings,requests,invitations});if(blocked)throw new InterviewError(blocked,409);
 const managedRow=await db.from('interview_generated_availability').select('notion_page_id').eq('teacher',teacherKey(teacher.name)).eq('slot_date',slotData.date).eq('start_time',slotData.start).maybeSingle();
 if(managedRow.error)throw new InterviewError('自動作成枠との関係を確認できません。',503);
 if(managedRow.data&&key(managedRow.data.notion_page_id)!==key(pageId))throw new InterviewError('同じ時刻に別の自動作成枠があります。削除前に確認してください。',409);
 // Stop parent visibility first. A failed Notion call leaves a safely hidden slot that can be retried.
 if(slot){
  const stopped=await db.from('interview_public_slots').update({published:false,source_available:false,version:Number(slot.version)+1,updated_by:actor.staffId,updated_at:new Date().toISOString()}).eq('id',slot.id).eq('version',slot.version).select('id').maybeSingle();
  if(stopped.error||!stopped.data)throw new InterviewError('公開状態が更新されました。再読み込みして確認してください。',409);
 }
 if(!page.archived&&!page.in_trash){
  const latest=await bensukeRequest(`/pages/${pageId}`);
  if(latest.archived||latest.in_trash||latest.last_edited_time!==editedAt)throw new InterviewError('Notionの予約可が変更されました。再読み込みして確認してください。',409);
  const archived=await bensukeRequest(`/pages/${pageId}`,{method:'PATCH',body:JSON.stringify({archived:true})});
  if(!archived.archived)throw new InterviewError('Notionでの削除を確認できません。再読み込みしてください。',503);
 }
 const managed=await db.from('interview_generated_availability').upsert({teacher:teacherKey(teacher.name),slot_date:slotData.date,start_time:slotData.start,campus:slotData.campus,notion_page_id:pageId,notion_edited_at:editedAt,expected:{...value,manuallyRemoved:true},status:'archived',updated_at:new Date().toISOString()},{onConflict:'teacher,slot_date,start_time'});
 if(managed.error)throw new InterviewError('Notionの削除は完了しましたが、管理履歴を更新できません。管理者へ連絡してください。',503);
 const result={pageId,archived:true};
 const saved=await db.from('interview_request_events').insert({operation_key:operationKey,actor:`staff:${actor.staffId}`,request_id:null,action:'archive_availability',payload:{pageId,editedAt,teacher:teacherKey(actor.displayName)},result});
 if(saved.error)throw new InterviewError('Notionの削除は完了しましたが、操作履歴を記録できません。管理者へ連絡してください。',503);
 return result;
}
