import { StaffAuthError } from './staff-auth-core.mjs';

export const initialLoginNames = ['金城','工藤','鈴木','髙山','金子','箭内','真下','佐藤（治）','佐藤（俊）','岩本','森松','寺尾','館林','川口','田中','井上','東','浅野','内田','森','竹中'];
export function loginPersonName(value) {
  if (typeof value !== 'string') throw new StaffAuthError('invalid_request', 400);
  const displayName = value.trim();
  if (!displayName || displayName.length > 50 || /[\p{Cc}\p{Cf}<>]/u.test(displayName)) throw new StaffAuthError('invalid_request', 400);
  return { displayName, nameKey: displayName.normalize('NFKC').replace(/\s/gu, '') };
}
export async function loginPeople(client) {
  const { data, error } = await client.from('staff_login_people').select('id,display_name').eq('active', true).order('sort_order').order('display_name');
  if (error) throw new StaffAuthError('auth_unavailable', 503);
  return data ?? [];
}
export async function addLoginPerson(client, staff, value) {
  if (staff.role !== 'admin') throw new StaffAuthError('permission_denied', 403);
  const { displayName, nameKey } = loginPersonName(value);
  const { data: last, error: lastError } = await client.from('staff_login_people').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw new StaffAuthError('auth_unavailable', 503);
  const { data, error } = await client.from('staff_login_people').insert({ display_name: displayName, name_key: nameKey, account_name: displayName, sort_order: (last?.sort_order ?? 0) + 1 }).select('id,display_name').single();
  if (error?.code === '23505') throw new StaffAuthError('person_exists', 409);
  if (error) throw new StaffAuthError('auth_unavailable', 503);
  return data;
}
