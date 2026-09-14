import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {InterviewError} from '@/lib/interview-core.mjs';
import {readBensukeDay} from '@/lib/bensuke-reader.mjs';
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
  return staffResponse(result,context);
 }catch(error){
  if(error instanceof StaffAuthError)return staffErrorResponse(error,context);
  if(error instanceof InterviewError)return staffResponse({error:error.message},context,error.status);
  if(context)return staffResponse({error:'ベンスケの予定を取得できませんでした。接続状態を確認して再取得してください。'},context,503);
  return staffErrorResponse(error,context);
 }
}
