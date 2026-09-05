import { NextRequest } from 'next/server';
import { saveStaffStudyRoomVisit } from '@/lib/staff-study-room-visits.mjs';
import { assertStaffMutationOrigin,staffContext,staffErrorResponse,staffJsonBody,staffResponse } from '@/lib/staff-auth-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
  let context:Awaited<ReturnType<typeof staffContext>>|undefined;
  try {
    assertStaffMutationOrigin(request);
    context=await staffContext(request);
    const result=await saveStaffStudyRoomVisit(context.dataClient,context.identity,await staffJsonBody(request));
    return staffResponse(result,context);
  } catch(error) {return staffErrorResponse(error,context);}
}
