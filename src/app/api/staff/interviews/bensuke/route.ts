import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {InterviewError,minutes,normalizeTeacher} from '@/lib/interview-core.mjs';
import {BENSUKE_SOURCE,staffDirectory} from '@/lib/bensuke-booking.mjs';
import {readBensukeDay} from '@/lib/bensuke-reader.mjs';
import {isKinjoSlot,isKinjoTeacher} from '@/lib/kinjo-interview-slots.mjs';
import {notionRequest} from '@/lib/notion';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
 let context;
 try{
  context=await staffContext(request);assertInterviewAccess(context.staff);
  const result=await readBensukeDay({date:request.nextUrl.searchParams.get('date')??'',sourceId:process.env.NOTION_BENSUKE_DATA_SOURCE_ID,
   request:(path:string,init?:RequestInit)=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)})});
  const {data:used,error:usedError}=await context.dataClient.from('interview_bookings').select('notion_page_id').not('notion_page_id','is',null);
  if(usedError)throw new InterviewError('面談の枠確保状況を確認できません。',503);
  const held=new Set((used??[]).map(r=>r.notion_page_id));
  const schema=await notionRequest(`/data_sources/${BENSUKE_SOURCE}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
  const directory=await staffDirectory((path:string,init?:RequestInit)=>notionRequest(path,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)}),schema);
  const rows=result.rows.map(row=>{
   const names=row.teacherIds.map((id:string)=>directory.find(r=>r.id===id)?.name??'Notionで確認');
   const teacher=names.length===1?normalizeTeacher(names[0]).replace(/(?:先生|さん)$/u,''):'';
   const source=row.availability;
   let availability:unknown=source;
   if(source?.usable&&'start' in source){
    if(!teacher)availability={usable:false,reason:'担当講師を確認してください。'};
    else if(isKinjoTeacher(teacher)&&!isKinjoSlot(source.start,source.end))availability={usable:false,reason:'金城先生専用の時刻ではありません。'};
    else if(!isKinjoTeacher(teacher)&&(!source.end||minutes(source.end)-minutes(source.start)!==45))availability={usable:false,reason:'この先生の面談45分の枠ではありません。'};
    else availability={...source,teacher,...(isKinjoTeacher(teacher)?{availabilityRule:'kinjo'}:{})};
   }
   return {...row,fields:row.fields.map(f=>f.name==='担当者'&&names.length?{...f,value:names.join('、')}:f),availability:held.has(row.id)?{usable:false,reason:'勉たんで受付済みの枠です。面談一覧で確認してください。'}:availability};
  });
  return staffResponse({...result,rows},context);
 }catch(error){
  if(error instanceof StaffAuthError)return staffErrorResponse(error,context);
  if(error instanceof InterviewError)return staffResponse({error:error.message},context,error.status);
  if(context)return staffResponse({error:'ベンスケの予定を取得できませんでした。接続状態を確認して再取得してください。'},context,503);
  return staffErrorResponse(error,context);
 }
}
