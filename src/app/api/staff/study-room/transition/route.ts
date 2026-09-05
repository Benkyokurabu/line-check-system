import { NextRequest } from "next/server";
import { transitionStaffStudyRoom } from "@/lib/staff-auth-core.mjs";
import { assertStaffMutationOrigin, staffContext, staffErrorResponse, staffJsonBody, staffResponse } from "@/lib/staff-auth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof staffContext>> | undefined;
  try {
    assertStaffMutationOrigin(request);
    context = await staffContext(request);
    const body = await staffJsonBody(request);
    const result = await transitionStaffStudyRoom(context.dataClient, context.identity, body);
    return staffResponse(result, context);
  } catch (error) { return staffErrorResponse(error, context); }
}
