import { NextRequest } from 'next/server';
import { assertStaffMutationOrigin, staffContext, staffResponse, staffErrorResponse, staffJsonBody } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const number = request.nextUrl.searchParams.get('number') ?? '';
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    const { data: student, error: rosterError } = await context.dataClient.from('student_registry')
      .select('student_number').eq('student_number', number).eq('enrollment_status', 'current_roster').maybeSingle();
    if (rosterError) throw new InterviewError('生徒台帳を取得できません。', 503);
    if (!student) throw new InterviewError('在籍生徒が見つかりません。', 404);
    const { data, error } = await context.dataClient.from('interview_material_info_summaries')
      .select('source_hash,status,requested,result').eq('student_number', number).maybeSingle();
    if (error) throw new InterviewError('情報の要約を取得できません。', 503);
    return staffResponse({ summary: data ? { sourceHash: data.source_hash,
      status: data.status === 'queued' && !data.requested ? 'prepared' : data.status,
      items: Array.isArray(data.result) ? data.result : [] } : { status: 'empty', items: [] } }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}

export async function POST(request: NextRequest) {
  let context;
  try {
    assertStaffMutationOrigin(request);
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const body = await staffJsonBody(request);
    const number = String(body.number ?? '');
    if (!/^\d{5,12}$/.test(number)) throw new InterviewError('生徒番号を確認してください。', 400);
    const { data: student, error: rosterError } = await context.dataClient.from('student_registry')
      .select('student_number').eq('student_number', number).eq('enrollment_status', 'current_roster').maybeSingle();
    if (rosterError) throw new InterviewError('生徒台帳を取得できません。', 503);
    if (!student) throw new InterviewError('在籍生徒が見つかりません。', 404);
    const { data: row, error: readError } = await context.dataClient.from('interview_material_info_summaries')
      .select('source_hash,status,requested').eq('student_number', number).maybeSingle();
    if (readError) throw new InterviewError('情報の要約を確認できません。', 503);
    if (!row) throw new InterviewError('生徒情報を先に読み込んでください。', 409);
    if (row.status === 'completed' || row.status === 'running' || row.status === 'queued' && row.requested)
      return staffResponse({ status: row.status }, context);
    const { error } = await context.dataClient.from('interview_material_info_summaries')
      .update({ status: 'queued', requested: true, attempts: 0, error: null, updated_at: new Date().toISOString() })
      .eq('student_number', number).eq('source_hash', row.source_hash);
    if (error) throw new InterviewError('AI要約を依頼できません。', 503);
    return staffResponse({ status: 'queued' }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
