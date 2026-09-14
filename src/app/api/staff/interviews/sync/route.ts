import { NextRequest } from 'next/server';
import { staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin } from '@/lib/staff-auth-http';
import { syncInterview } from '@/lib/interview-sync';
import { InterviewError } from '@/lib/interview-core.mjs';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:NextRequest){
 let context;
 try{
  assertStaffMutationOrigin(request);context=await staffContext(request);
  if(!['admin','office','employee'].includes(context.staff.role))return staffResponse({error:'同期操作の権限がありません。'},context,403);
  const body=await staffJsonBody(request);
  if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id))return staffResponse({error:'面談を選択してください。'},context,400);
  return staffResponse(await syncInterview(context.dataClient,body.id),context);
 }catch(e){return e instanceof InterviewError?staffResponse({error:e.message},context,e.status):staffErrorResponse(e,context);}
}
