import { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase';
import { loginAvailabilityTeacher } from '@/lib/availability-teacher-login.mjs';
import { assertStaffMutationOrigin, staffErrorResponse, staffJsonBody, staffResponse } from '@/lib/staff-auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertStaffMutationOrigin(request);
    const body = await staffJsonBody(request);
    const context = await loginAvailabilityTeacher({ identityClient: createSupabaseAdminClient(),
      dataClient: createSupabaseAdminClient(), teacherId: body.teacherId, password: body.password });
    return staffResponse({ staff: context.staff }, context);
  } catch (error) { return staffErrorResponse(error); }
}
