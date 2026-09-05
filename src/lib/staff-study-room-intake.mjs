import { StaffAuthError } from './staff-auth-core.mjs';
import { isValidReservationDate } from './reservation-date.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slots = new Set(['14:55-16:25','16:45-18:15','18:35-20:05','20:25-21:55']);
export async function submitStaffStudyRoom(dataClient, identity, input) {
  if (!uuid.test(input?.operationKey ?? '') || typeof input?.studentNumber !== 'string'
    || !input.studentNumber.trim() || input.studentNumber.length > 64 || !isValidReservationDate(input.date)
    || !Number.isInteger(input.seat) || input.seat < 1 || input.seat > 10
    || !Array.isArray(input.slotIds) || input.slotIds.length < 1 || input.slotIds.length > 4
    || input.slotIds.some(slot => !slots.has(slot))
    || !['line_message','in_person','phone','other'].includes(input.contactChannel)
    || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000) {
    throw new StaffAuthError('invalid_request',400);
  }
  const { data,error } = await dataClient.rpc('staff_study_room_submit',{
    p_auth_user_id:identity.authUserId,p_auth_session_id:identity.authSessionId,
    p_operation_key:input.operationKey,p_student_number:input.studentNumber.trim(),
    p_date:input.date,p_seat:input.seat,p_slot_ids:input.slotIds,
    p_contact_channel:input.contactChannel,p_note:input.note.trim(),
  });
  if (error) {
    if (error.message === 'student_not_found') throw new StaffAuthError('invalid_request',400);
    if (error.message === 'staff_permission_denied') throw new StaffAuthError('permission_denied',403);
    if (['staff_access_denied','staff_session_invalid','staff_session_expired'].includes(error.message)) throw new StaffAuthError('invalid_session');
    if (['seat_unavailable','student_slot_conflict','daily_limit_exceeded','slot_closed','past_date',
      'pending_student_slot_conflict','idempotency_conflict'].includes(error.message)) throw new StaffAuthError('reservation_conflict',409);
    throw new StaffAuthError('auth_unavailable',503);
  }
  return data;
}
