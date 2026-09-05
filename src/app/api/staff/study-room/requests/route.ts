import { NextRequest } from "next/server";
import { listStaffStudyRoom } from "@/lib/staff-auth-core.mjs";
import { staffContext, staffErrorResponse, staffResponse } from "@/lib/staff-auth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof staffContext>> | undefined;
  try {
    context = await staffContext(request);
    const params = request.nextUrl.searchParams;
    const offset = params.get("offset") ?? "0";
    const result = await listStaffStudyRoom(context.dataClient, context.identity, {
      date: params.get("date"), status: params.get("status"),
      offset: /^\d+$/.test(offset) ? Number(offset) : NaN,
    });
    return staffResponse(result, context);
  } catch (error) { return staffErrorResponse(error, context); }
}
