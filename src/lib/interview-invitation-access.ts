import 'server-only';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {createSupabaseAdminClient} from './supabase';
import {InterviewError} from './interview-core.mjs';
export const invitationCookie='__Host-bentan-invitation';
export const invitationCookieOptions={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/',maxAge:86400};
export async function invitationAccess(token:unknown){
 if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw new InterviewError('最新の案内LINEのリンクから開いてください。',401);
 const dataClient=createSupabaseAdminClient(),hash=createHash('sha256').update(token).digest('hex');
 const {data,error}=await dataClient.rpc('interview_invitation_access_check',{p_hash:hash});
 if(error)throw new InterviewError('接続を確認して、もう一度お試しください。',503);
 if(!data)throw new InterviewError('このリンクの受付は終了しました。最新の案内LINEを確認してください。',401);
 return {dataClient,hash,id:String(data.id),studentId:String(data.studentId)};
}
export async function invitationContext(request:NextRequest){
 const token=request.cookies.get(invitationCookie)?.value;
 return token?invitationAccess(token):null;
}
