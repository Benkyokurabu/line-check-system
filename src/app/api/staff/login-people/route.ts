import { createSupabaseAdminClient } from '@/lib/supabase';
import { loginPeople } from '@/lib/staff-login-directory.mjs';
import { assertStaffAuthEnabled, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { assertStaffAuthEnabled(); return staffResponse({ teachers: await loginPeople(createSupabaseAdminClient()) }); }
  catch (error) { return staffErrorResponse(error); }
}
