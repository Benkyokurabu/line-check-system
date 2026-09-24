import { scryptSync, timingSafeEqual } from 'node:crypto';
import { loginStaff, StaffAuthError } from './staff-auth-core.mjs';

// Only the salted verifier is deployed. The common password is never stored in source or in the teacher directory.
const passwordSalt = Buffer.from('358898479514cc5951c8fcd33335a101', 'hex');
const passwordVerifier = Buffer.from('cc243af65f50578193bc34aa9cda5afa8585d4ebf3561fc6d3d407618ea31afd4c4bb4e8a581aa3d02db45fd43d21e17853b9ad4e65835f11b4968ae6f36e61a', 'hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function availabilityStaffCode(teacherId) {
  if (typeof teacherId !== 'string' || !uuid.test(teacherId)) throw new StaffAuthError('invalid_credentials');
  return `AVAIL_${teacherId.replaceAll('-', '').toUpperCase()}`;
}

export function matchesAvailabilityPassword(password) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) return false;
  return timingSafeEqual(scryptSync(password, passwordSalt, passwordVerifier.length), passwordVerifier);
}

async function takeAttempt(db, teacherId) {
  const key = `availability-login:${teacherId}`;
  for (let retry = 0; retry < 6; retry++) {
    const current = await db.from('staff_login_buckets').select('started_at,attempts').eq('bucket_key', key).maybeSingle();
    if (current.error) throw new StaffAuthError('auth_unavailable', 503);
    if (!current.data) {
      const inserted = await db.from('staff_login_buckets').insert({ bucket_key: key, attempts: 1 });
      if (!inserted.error) return;
      if (inserted.error.code === '23505') continue;
      throw new StaffAuthError('auth_unavailable', 503);
    }
    const previous = current.data, reset = Date.parse(previous.started_at) + 600000 <= Date.now();
    if (!reset && previous.attempts >= 5) throw new StaffAuthError('try_later', 429);
    const updated = await db.from('staff_login_buckets').update(reset
      ? { started_at: new Date().toISOString(), attempts: 1 }
      : { attempts: previous.attempts + 1 })
      .eq('bucket_key', key).eq('started_at', previous.started_at).eq('attempts', previous.attempts)
      .select('attempts').maybeSingle();
    if (updated.error) throw new StaffAuthError('auth_unavailable', 503);
    if (updated.data) return;
  }
  throw new StaffAuthError('try_later', 429);
}

export async function loginAvailabilityTeacher({ dataClient, identityClient, teacherId, password }) {
  const staffCode = availabilityStaffCode(teacherId);
  const teacherResult = await dataClient.from('teachers').select('id,display_name').eq('id', teacherId).maybeSingle();
  if (teacherResult.error) throw new StaffAuthError('auth_unavailable', 503);
  const teacher = teacherResult.data;
  if (!teacher?.display_name?.trim()) throw new StaffAuthError('invalid_credentials');
  await takeAttempt(dataClient, teacherId);
  if (!matchesAvailabilityPassword(password)) throw new StaffAuthError('invalid_credentials');

  const existing = await dataClient.from('staff_accounts').select('auth_user_id,display_name,role,active').eq('staff_code', staffCode).maybeSingle();
  if (existing.error) throw new StaffAuthError('auth_unavailable', 503);
  if (existing.data) {
    if (!existing.data.active || existing.data.role !== 'teacher' || existing.data.display_name !== teacher.display_name || !existing.data.auth_user_id) {
      throw new StaffAuthError('permission_denied', 403);
    }
  } else {
    const email = `availability-${teacherId}@users.bentan.invalid`;
    const created = await identityClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data?.user?.id) throw new StaffAuthError('auth_unavailable', 503);
    const saved = await dataClient.from('staff_accounts').insert({ auth_user_id: created.data.user.id,
      staff_code: staffCode, display_name: teacher.display_name, role: 'teacher', active: true });
    if (saved.error) {
      await identityClient.auth.admin.deleteUser(created.data.user.id);
      throw new StaffAuthError('auth_unavailable', 503);
    }
  }
  return loginStaff({ identityClient, dataClient, staffCode, password });
}
