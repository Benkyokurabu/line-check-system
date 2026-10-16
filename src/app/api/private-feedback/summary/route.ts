import {NextRequest} from 'next/server';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 let context;
 try{
  context=await staffContext(request);
  const result=await context.dataClient.rpc('feedback_inbox_summary',{p_auth_user_id:context.identity.authUserId,p_auth_session_id:context.identity.authSessionId});
  if(result.error)throw new StaffAuthError(result.error.message==='staff_permission_denied'?'permission_denied':'auth_unavailable',result.error.message==='staff_permission_denied'?403:503);
  return staffResponse(result.data,context);
 }catch(error){return staffErrorResponse(error,context);}
}
