import { loadInterviewMaterialContext } from '@/lib/interview-material-context-loader';
import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const number = request.nextUrl.searchParams.get('number') ?? '';
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    return staffResponse(await loadInterviewMaterialContext(context.dataClient, number), context);
  } catch (error) {
    if (error instanceof InterviewError) return staffResponse({ error: error.message }, context, error.status);
    if (context) {
      console.error('Failed to load interview material context', error);
      return staffResponse({ error: '面談記録を取得できません。時間をおいて再読み込みしてください。' }, context, 503);
    }
    return staffErrorResponse(error);
  }
}
