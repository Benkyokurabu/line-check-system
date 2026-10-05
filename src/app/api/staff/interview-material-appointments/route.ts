import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { BENSUKE_SOURCE, checkedPage, staffDirectory } from '@/lib/bensuke-booking.mjs';
import { readBensukeDay } from '@/lib/bensuke-reader.mjs';
import { extractMaterialDecisions, resolveMaterialAppointments } from '@/lib/bensuke-material-ai.mjs';
import { loadMaterialStudents } from '@/lib/interview-material-students';
import { notionRequest } from '@/lib/notion';

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
    const sourceId = process.env.NOTION_BENSUKE_DATA_SOURCE_ID || BENSUKE_SOURCE;
    const read = (path: string, init?: RequestInit) => notionRequest(path,
      { ...init, cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
    const [day, schema, students] = await Promise.all([
      readBensukeDay({ date, sourceId, request: read }), read(`/data_sources/${sourceId}`),
      loadMaterialStudents(context.dataClient),
    ]);
    const directory = await staffDirectory(read, schema);
    const rows = day.rows.filter(row => !row.availability);
    const decisions = await extractMaterialDecisions(rows, { key: process.env.GROQ_API_KEY });
    const result = resolveMaterialAppointments({ rows, decisions, students, directory, date });
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
