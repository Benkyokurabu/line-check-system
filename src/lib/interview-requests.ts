import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadInterviewState,readAll,type InterviewState} from './interview-store';
import {conflicts,InterviewError,normalizeTeacher,validateAppointment} from './interview-core.mjs';
import {getJapanDate} from './reservation-date.mjs';
import {BENSUKE_SOURCE,queryPages,staffDirectory,scheduleValue,checkedPage,prepareBinding} from './bensuke-booking.mjs';
import {bensukeAvailability} from './bensuke-reader.mjs';
import {bensukeRequest} from './interview-sync';
type Row=Record<string,unknown>;
export type Slot={id:string;notion_page_id:string;data:Record<string,string>;version:number;published:boolean;notion_edited_at:string;source_available?:boolean};
const teacherKey=(s:unknown)=>normalizeTeacher(s).replace(/(?:先生|さん)$/u,'');
const dayAfter=(n:number)=>new Date(Date.parse(getJapanDate()+'T12:00:00+09:00')+n*86400000).toISOString().slice(0,10);
export function available(slot:Slot,state:InterviewState,teacher:unknown){
 return !!teacherKey(teacher)&&slot.published&&slot.source_available!==false&&slot.data.date>=dayAfter(1)&&slot.data.date<=dayAfter(60)&&teacherKey(slot.data.teacher)===teacherKey(teacher)
 &&!state.bookings.some(b=>b.notion_page_id===slot.notion_page_id)
 &&conflicts(slot.data,state.lessons,state.bookings).length===0;
}
export const dateOnly=(d:Record<string,unknown>)=>({date:d.date,start:d.start,end:d.end});
export function parentRequest(row:Row,bookings:Row[]){
 const booking=bookings.find(b=>b.id===row.booking_id);
 return {id:row.id,studentId:row.student_id,status:row.status,version:row.version,note:row.note,reason:row.reason,
  choices:(row.choices as {slotId:string;data:Record<string,string>}[]).map(c=>({slotId:c.slotId,...dateOnly(c.data)})),
  confirmed:booking?{...dateOnly(booking.data as Row),status:booking.status}:null};
}
export async function parentView(db:SupabaseClient,lineUserId:string){
 const links=await db.from('student_line_accounts').select('student_number').eq('line_user_id',lineUserId).eq('verification_status','confirmed').in('relation',['mother','father','guardian','shared','student']).limit(100);
 if(links.error)throw new InterviewError('登録情報を確認できません。',503);
 if(!links.data.length)return {students:[],slots:[],requests:[]};
 const state=await loadInterviewState(db),numbers=new Set(links.data.map(l=>l.student_number));
 const students=state.students.filter(r=>numbers.has(r.student_number as string)&&r.enrollment_status==='current_roster'&&r.id);
 if(!students.length)return {students:[],slots:[],requests:[]};
 await refreshHomeroomSlots(db,students,state);
 const slots=await readAll(db,'interview_public_slots') as Slot[];
 const requests=await db.from('interview_parent_requests').select('*').in('student_id',students.map(s=>s.id)).order('created_at',{ascending:false}).limit(100);
 if(requests.error)throw new InterviewError('申請状況を読み込めません。',503);
 return {students:students.map(s=>({id:s.id,name:s.student_name,teacher:teacherKey(s.homeroom_teacher)})),slots:students.flatMap(s=>slots.filter(slot=>available(slot,state,s.homeroom_teacher)).map(slot=>({id:slot.id,studentId:s.id,...dateOnly(slot.data)}))).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.start).localeCompare(String(b.start))),requests:requests.data.map(r=>parentRequest(r,state.bookings))};
}
export async function refreshHomeroomSlots(db:SupabaseClient,students:Row[],state:InterviewState){
 const teachers=[...new Set(students.map(s=>teacherKey(s.homeroom_teacher)).filter(Boolean))];
 if(!teachers.length)return;
 const checked=new Date().toISOString();
 const offers=await notionOffers(); // A failed/partial read throws; never publish stale data.
 if(state.settings.data.duration!==45)throw new InterviewError('面談時間の設定を教室で確認してください。',503);
 const values=offers.filter(o=>teachers.includes(o.teacher)).flatMap(o=>{
  try{
   const data=validateAppointment({...o,studentId:'00000000-0000-4000-8000-000000000000',method:'Zoom',purpose:'保護者面談',participants:'保護者',channel:'LINE',note:''},state.settings.data);
   if(conflicts(data,state.lessons,state.bookings).length||state.bookings.some(b=>b.notion_page_id===o.pageId))return [];
   return [{pageId:o.pageId,editedAt:o.editedAt,data}];
  }catch(error){if(error instanceof InterviewError&&error.status===422)return [];throw error;}
 });
 const result=await db.rpc('interview_refresh_slots',{p_teachers:teachers,p_offers:values,p_checked:checked});
 if(result.error)throw new InterviewError('担任の空き日程を更新できませんでした。もう一度お試しください。',503);
}
export async function bindingForSlot(slot:Slot,student:Row,state:InterviewState,note=''){
 const data=validateAppointment({...slot.data,studentId:student.id,method:'Zoom',channel:'LINE',purpose:'保護者面談',participants:'保護者',note},state.settings.data);
 if(!available(slot,state,student.homeroom_teacher))throw new InterviewError('選んだ日程を現在は受け付けていません。',409);
 const binding=await prepareBinding({request:bensukeRequest,pageId:slot.notion_page_id,editedAt:slot.notion_edited_at,data});
 return {...data,bensuke:binding,manualReviewed:true,externalReviewed:true};
}
export async function notionOffers(){
 const schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`),directory=await staffDirectory(bensukeRequest,schema);
 const pages=await queryPages(bensukeRequest,BENSUKE_SOURCE,{and:[{property:'日時',date:{on_or_after:dayAfter(1)}},{property:'日時',date:{on_or_before:dayAfter(60)}},{or:[{property:'内容',multi_select:{contains:'本：予約可'}},{property:'内容',multi_select:{contains:'南：予約可'}}]}]});
 return pages.flatMap((page:Row)=>{
  const a=bensukeAvailability(page);if(!a?.usable||!('date' in a))return [];
  const value=scheduleValue(page,schema),teachers=value.teachers.map((id:string)=>directory.find(d=>d.id===id)?.name??'');
  if(teachers.length!==1||!teachers[0])return [];
  return [{pageId:page.id,editedAt:page.last_edited_time,...a,teacher:teacherKey(teachers[0])}];
 }).sort((a:{date:string;start:string},b:{date:string;start:string})=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
}
export async function publishData(pageId:string,state:InterviewState){
 const schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`),page=await checkedPage(bensukeRequest,pageId,BENSUKE_SOURCE),a=bensukeAvailability(page);
 if(!a?.usable||!('date' in a)||a.date<dayAfter(1)||a.date>dayAfter(60))throw new InterviewError('翌日から60日先までの予約可を選んでください。');
 const value=scheduleValue(page,schema),directory=await staffDirectory(bensukeRequest,schema);
 if(value.teachers.length!==1)throw new InterviewError('Notionの予約可に担当講師を1人設定してください。');
 const teacher=teacherKey(directory.find(t=>t.id===value.teachers[0])?.name);
 if(!teacher)throw new InterviewError('担当講師を確認してください。');
 const data=validateAppointment({...a,teacher,studentId:'00000000-0000-4000-8000-000000000000',method:'Zoom',purpose:'保護者面談',participants:'保護者',channel:'LINE',note:''},state.settings.data);
 if(state.settings.data.duration!==45)throw new InterviewError('予約可の45分枠と面談時間の設定を合わせてください。');
 if(conflicts(data,state.lessons,state.bookings).length||state.bookings.some(b=>b.notion_page_id===pageId))throw new InterviewError('授業または面談と重なるため公開できません。',409);
 await prepareBinding({request:bensukeRequest,pageId,editedAt:page.last_edited_time,data});
 return {data,editedAt:page.last_edited_time};
}
