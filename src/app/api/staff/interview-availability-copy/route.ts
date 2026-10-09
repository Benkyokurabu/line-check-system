import {NextRequest} from 'next/server';
import {staffContext, staffResponse, staffErrorResponse} from '@/lib/staff-auth-http';
import {InterviewError} from '@/lib/interview-core.mjs';
import {copyTeacherOptions, readAvailabilityCopy} from '@/lib/availability-copy-notion.mjs';
import {notionRequest} from '@/lib/notion';
import {materialReadRequest} from '@/lib/interview-material-read.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('予約可を確認する権限がありません。', 403);
    const deadline = AbortSignal.timeout(55000);
    const read = materialReadRequest(notionRequest, deadline);
    const params = request.nextUrl.searchParams;
    if (params.get('mode') === 'teachers') {
      const {teachers, defaultTeacherId} = await copyTeacherOptions(read, context.staff);
      return staffResponse({teachers, defaultTeacherId}, context);
    }
    return staffResponse(await readAvailabilityCopy({request: read, actor: context.staff, from: params.get('from') ?? '', to: params.get('to') ?? '', teacherId: params.get('teacherId') ?? ''}), context);
  } catch (error) {
    if (error instanceof InterviewError) return staffResponse({error: error.message}, context, error.status);
    if (context) return staffResponse({error: 'Notionの予約可を取得できませんでした。時間をおいて再取得してください。'}, context, 503);
    return staffErrorResponse(error, context);
  }
}
