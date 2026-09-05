import { StaffAuthError } from './staff-auth-core.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp=value=>value===null || (typeof value==='string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && Number.isFinite(Date.parse(value)));
export async function saveStaffStudyRoomVisit(client,identity,input) {
  if(!uuid.test(input?.operationKey??'') || !uuid.test(input?.requestId??'')
    || !Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion<0 || input.expectedVersion>2147483646
    || !timestamp(input.startedAt) || !timestamp(input.endedAt)
    || ![null,'lesson','home','other'].includes(input.destination)
    || typeof input.reason!=='string' || input.reason.length>2000) throw new StaffAuthError('invalid_request',400);
  const {data,error}=await client.rpc('staff_study_room_save_visit',{
    p_auth_user_id:identity.authUserId,p_auth_session_id:identity.authSessionId,
    p_operation_key:input.operationKey,p_request_id:input.requestId,p_expected_version:input.expectedVersion,
    p_started_at:input.startedAt,p_ended_at:input.endedAt,p_destination:input.destination,p_reason:input.reason.trim(),
  });
  if(error) {
    if(error.message==='staff_permission_denied') throw new StaffAuthError('permission_denied',403);
    if(['staff_access_denied','staff_session_invalid','staff_session_expired'].includes(error.message)) throw new StaffAuthError('invalid_session');
    if(error.message==='reason_required') throw new StaffAuthError('reason_required',400);
    if(['invalid_visit_time','request_not_found','invalid_request'].includes(error.message)) throw new StaffAuthError('invalid_request',400);
    if(['version_conflict','idempotency_conflict','invalid_state_transition'].includes(error.message)) throw new StaffAuthError('reservation_conflict',409);
    throw new StaffAuthError('auth_unavailable',503);
  }
  return data;
}
