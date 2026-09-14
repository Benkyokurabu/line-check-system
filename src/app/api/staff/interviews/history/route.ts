import { NextRequest } from 'next/server';
import {assertInterviewAccess} from '@/lib/interview-access.mjs';
import { staffContext,staffResponse,staffErrorResponse } from '@/lib/staff-auth-http';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 let context;
 try{context=await staffContext(request);assertInterviewAccess(context.staff);const id=request.nextUrl.searchParams.get('id');
  if(!id||!/^[0-9a-f-]{36}$/i.test(id))return staffResponse({error:'面談を選択してください。'},context,400);
  const {data,error}=await context.dataClient.from('interview_events').select('action,reason,created_at,actor').eq('booking_id',id).order('created_at',{ascending:false}).limit(200);
  if(error)return staffResponse({error:'履歴を取得できませんでした。'},context,503);
  return staffResponse({events:data},context);
 }catch(e){return staffErrorResponse(e,context);}
}
