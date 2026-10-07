import { loadInterviewMaterialAppointments } from '@/lib/interview-material-appointments-loader';
import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { checkedPage } from '@/lib/bensuke-booking.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role))
      throw new InterviewError('職員の権限を確認してください。', 403);
    const date = request.nextUrl.searchParams.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InterviewError('面談日を選んでください。');
    const { appointments, review, directory, day, sourceId, read } = await loadInterviewMaterialAppointments(context.dataClient, date, request.signal);
    const result = { appointments, review };
    const verifyId = request.nextUrl.searchParams.get('verify');
    if (verifyId) {
      const selected = result.appointments.find(row => row.id === verifyId);
      if (!selected) throw new InterviewError('面談予定が変更されました。日付を選び直してください。', 409);
      const latest = await checkedPage(read, verifyId, sourceId);
      if (latest.last_edited_time !== selected.editedAt)
        throw new InterviewError('Notionの予定が判定中に更新されました。日付を選び直してください。', 409);
    }
    const teachers = directory.filter(staff => day.rows.some(row => row.teacherIds.some((id: string) =>
      id.replaceAll('-', '').toLowerCase() === staff.id.replaceAll('-', '').toLowerCase()))
      || result.appointments.some(row => row.teacherId === staff.id)
      || result.review.some(row => row.teacherIds.includes(staff.id)))
      .map(staff => ({ id: staff.id, name: staff.name.replace(/(?:先生|さん)$/u, '') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return staffResponse({ ...result, teachers, source: 'notion-bensuke', checkedAt: day.checkedAt }, context);
  } catch (error) {
    if (error instanceof InterviewError) return staffResponse({ error: error.message }, context, error.status);
    if (context) return staffResponse({ error: 'Notionベンケイの予定を取得できませんでした。接続状態を確認して再取得してください。' }, context, 503);
    return staffErrorResponse(error, context);
  }
}
