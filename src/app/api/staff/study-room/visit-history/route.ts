import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  let context:Awaited<ReturnType<typeof staffContext>>|undefined;
  try {
    context=await staffContext(request);
    const id=request.nextUrl.searchParams.get('request');
    const raw=request.nextUrl.searchParams.get('before');
    const before=raw===null?null:Number(raw);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id??'')
      || (raw!==null && (!/^\d+$/.test(raw) || before===null || !Number.isSafeInteger(before) || before<1 || before>2147483647))) throw new StaffAuthError('invalid_request',400);
    const {data,error}=await context.dataClient.rpc('staff_study_room_visit_history',{
      p_auth_user_id:context.identity.authUserId,p_auth_session_id:context.identity.authSessionId,p_request_id:id,p_before_version:before,
    });
    if(error) {
      if(error.message==='staff_permission_denied') throw new StaffAuthError('permission_denied',403);
      if(['staff_access_denied','staff_session_invalid','staff_session_expired'].includes(error.message)) throw new StaffAuthError('invalid_session');
      if(['invalid_request','request_not_found'].includes(error.message)) throw new StaffAuthError('invalid_request',400);
      throw new StaffAuthError('auth_unavailable',503);
    }
    return staffResponse(data,context);
  } catch(error) {return staffErrorResponse(error,context);}
}
