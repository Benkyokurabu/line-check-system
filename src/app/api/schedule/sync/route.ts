import { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { syncSchedule } from "@/lib/schedule-sync.mjs";
import { ScheduleCloudError } from "@/lib/schedule-cloud.mjs";
import {staffContext,staffResponse,staffErrorResponse,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
// Wake up the same constrained trusted-folder worker used by cron. No uploaded plan,
// arbitrary lessons, approvals, deletions or credential changes are accepted here.
export async function POST(request: NextRequest) {
  let context:Awaited<ReturnType<typeof staffContext>>|undefined;
  try {
    assertStaffMutationOrigin(request);
    context=await staffContext(request);
    if(!['admin','office','employee'].includes(context.staff.role))throw new StaffAuthError('permission_denied',403);
    const result = await syncSchedule(context.dataClient, request.nextUrl.searchParams.get("month"), getServerEnv().SUPABASE_SECRET_KEY);
    return staffResponse(result,context);
  } catch (e) {
    if(e instanceof StaffAuthError)return staffErrorResponse(e,context);
    return staffResponse({ error: e instanceof ScheduleCloudError ? e.message : "自動反映に接続できませんでした。再試行してください。" },context,e instanceof ScheduleCloudError ? e.status : 503);
  }
}
