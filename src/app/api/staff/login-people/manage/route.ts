import { NextRequest } from 'next/server';
import { StaffAuthError } from '@/lib/staff-auth-core.mjs';
import { addLoginPerson, loginPeople } from '@/lib/staff-login-directory.mjs';
import { staffContext, staffResponse, staffErrorResponse, staffJsonBody, assertStaffMutationOrigin } from '@/lib/staff-auth-http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (context.staff.role !== 'admin') throw new StaffAuthError('permission_denied', 403);
    return staffResponse({ people: await loginPeople(context.dataClient) }, context);
  } catch (error) { return staffErrorResponse(error, context); }
}
export async function POST(request: NextRequest) {
  let context;
  try {
    assertStaffMutationOrigin(request); context = await staffContext(request);
    const body = await staffJsonBody(request);
    const person = await addLoginPerson(context.dataClient, context.staff, body.name);
    return staffResponse({ person }, context, 201);
  } catch (error) { return staffErrorResponse(error, context); }
}
