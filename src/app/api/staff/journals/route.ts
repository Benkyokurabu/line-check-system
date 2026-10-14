import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {ScheduleCloudError} from '@/lib/schedule-cloud.mjs';
import {listJournalCloudFiles} from '@/lib/journal-cloud.mjs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request:NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin','office','employee','teacher'].includes(context.staff.role)) throw new StaffAuthError('permission_denied',403);
    const result = await listJournalCloudFiles(context.dataClient,process.env.SUPABASE_SECRET_KEY);
    return staffResponse(result,context);
  } catch (error) {
    if (error instanceof StaffAuthError) return staffErrorResponse(error,context);
    return staffResponse({error:error instanceof ScheduleCloudError ? error.message : '授業日誌を取得できませんでした。再読み込みしてください。'},context,503);
  }
}
