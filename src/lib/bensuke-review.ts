import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {InterviewError,normalizeTeacher} from './interview-core.mjs';
import {BENSUKE_SOURCE,checkedPage,scheduleValue,staffDirectory,remoteAppointment,equivalentSchedule} from './bensuke-booking.mjs';
import {bensukeRequest} from './interview-sync';
export async function bensukeReview(db:SupabaseClient,id:string){
 const {data:booking,error}=await db.from('interview_bookings').select('*').eq('id',id).single();
 if(error||!booking?.notion_page_id||!booking.notion_original)throw new InterviewError('ベンスケに連携した面談を選択してください。',409);
 const schema=await bensukeRequest(`/data_sources/${BENSUKE_SOURCE}`);
 const page=await checkedPage(bensukeRequest,booking.notion_page_id,BENSUKE_SOURCE),remote=scheduleValue(page,schema);
 const directory=await staffDirectory(bensukeRequest,schema);
 const {data:settings}=await db.from('interview_settings').select('data').eq('id',true).single();
 let candidate:Record<string,unknown>|null=null,issue='';
 try{
  if(booking.status!=='confirmed'||booking.notion_synced_version!==booking.version||booking.notion_expected)throw new InterviewError('勉たんの未反映内容があります。先に「Notionへ反映」で結果を確認してください。',409);
  candidate=remoteAppointment(booking,remote,directory,settings?.data);
  // Reuse an exact registered teacher spelling, never guess a surname prefix.
  const {data:roster,error:rosterError}=await db.from('student_registry').select('homeroom_teacher');
  const {data:lessons,error:lessonError}=await db.from('lessons').select('teacher_name');
  if(rosterError||lessonError)throw new InterviewError('担当講師の台帳を取得できません。',503);
  const names=[...(roster??[]).map(r=>r.homeroom_teacher),...(lessons??[]).map(r=>r.teacher_name)].filter(Boolean);
  const candidateTeacher=candidate!.teacher;
  const match=names.find(n=>normalizeTeacher(n)===normalizeTeacher(candidateTeacher));
  if(!match)throw new InterviewError('Notionの担当者と勉たんの登録講師が一致しません。',409);
  candidate!.teacher=normalizeTeacher(match);
 }catch(e){candidate=null;issue=e instanceof InterviewError?e.message:'Notionの変更内容を取り込めません。';}
 return {booking,remote,editedAt:page.last_edited_time,candidate,issue,changed:!equivalentSchedule(remote,booking.notion_baseline),teacherNames:remote.teachers.map((id:string)=>directory.find(x=>x.id===id)?.name??'担当者を確認してください')};
}
