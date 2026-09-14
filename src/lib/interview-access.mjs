import {StaffAuthError} from './staff-auth-core.mjs';
// Temporary rollout scope requested by the owner. Check only the server-verified
// staff profile; URL parameters and form values never grant access.
export function canAccessInterviews(staff){
 return !!staff?.staffId && ['KUDO','KINJO'].includes(staff.staffCode);
}
export function assertInterviewAccess(staff){
 if(!canAccessInterviews(staff))throw new StaffAuthError('permission_denied',403);
}
