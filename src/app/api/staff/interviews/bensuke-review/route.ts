import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {bensukeReview} from '@/lib/bensuke-review';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
 let context;
 try{
  context=await staffContext(request);assertInterviewAccess(context.staff);
  if(!['admin','office','employee'].includes(context.staff.role))throw new InterviewError('確認する権限がありません。',403);
  const id=request.nextUrl.searchParams.get('id')??'';
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new InterviewError('面談を選択してください。');
  const r=await bensukeReview(context.dataClient,id);
  return staffResponse({id,version:r.booking.version,local:r.booking.data,remote:r.remote,editedAt:r.editedAt,canAdopt:!!r.candidate&&r.changed,issue:r.issue,changed:r.changed,teacherNames:r.teacherNames},context);
 }catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}
}
