import { NextRequest } from 'next/server';
import { assertStaffMutationOrigin, staffContext, staffErrorResponse, staffJsonBody, staffResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { loadInterviewState } from '@/lib/interview-store';
import { MATERIAL_BUCKET, online } from '@/lib/interview-material-worker';
import { loadVerifiedSurveyAnswer } from '@/lib/interview-surveys-notion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function contextFor(request: NextRequest) {
  const context = await staffContext(request);
  if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
  return context;
}

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await contextFor(request);
    const { data: workers, error: workersError } = await context.dataClient.from('interview_material_workers')
      .select('id,priority,ready,last_seen_at,status').order('priority');
    if (workersError) throw workersError;
    const available = (workers || []).filter(online).map(worker => ({ id: worker.id, priority: worker.priority, status: worker.status }));
    const jobId = request.nextUrl.searchParams.get('id');
    if (!jobId) {
      const { data: recent, error: recentError } = await context.dataClient.from('interview_material_jobs')
        .select('id,status,payload,created_at').eq('staff_code', context.staff.staffCode).eq('kind', 'generate')
        .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(10);
      if (recentError) throw recentError;
      return staffResponse({ available, recent: (recent || []).map(row => ({
        id: row.id, status: row.status, number: row.payload?.number, name: row.payload?.name, createdAt: row.created_at,
      })) }, context);
    }
    if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new InterviewError('依頼番号を確認してください。', 400);
    const { data: job, error } = await context.dataClient.from('interview_material_jobs')
      .select('id,kind,status,result,error,worker_id,created_at,completed_at,expires_at,lease_until,attempts')
      .eq('id', jobId).eq('staff_code', context.staff.staffCode).maybeSingle();
    if (error) throw error;
    if (!job) throw new InterviewError('作成依頼が見つかりません。', 404);
    let status = job.status;
    let message = job.error;
    if (status === 'queued' && Date.now() - Date.parse(job.created_at) > 10 * 60_000) {
      status = 'failed'; message = '作成PCが応答しませんでした。もう一度依頼してください。';
    } else if (status === 'running' && job.attempts >= 3 && job.lease_until && Date.parse(job.lease_until) < Date.now()) {
      status = 'failed'; message = '作成PCが途中で停止しました。もう一度依頼してください。';
    }
    let pdfUrl: string | null = null;
    if (status === 'completed' && job.kind === 'generate' && job.result?.storagePath) {
      const { data, error: signedError } = await context.dataClient.storage.from(MATERIAL_BUCKET)
        .createSignedUrl(String(job.result.storagePath), 600);
      if (signedError) throw signedError;
      pdfUrl = data.signedUrl;
    }
    return staffResponse({ available, job: { ...job, status, error: message, pdfUrl } }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}

export async function POST(request: NextRequest) {
  let context;
  try {
    assertStaffMutationOrigin(request);
    context = await contextFor(request);
    const body = await staffJsonBody(request);
    const kind = body.kind;
    const number = String(body.number || '');
    const schools = body.schools;
    const campus = String(body.campus || '');
    const answerId = typeof body.answerId === 'string' ? body.answerId : '';
    const selectedMaterialIds = Array.isArray(body.selectedMaterialIds) ? body.selectedMaterialIds : null;
    if (!['preview', 'generate'].includes(String(kind)) || !/^\d{5,12}$/.test(number)
      || !Array.isArray(schools) || schools.length > 6 || schools.some(name => typeof name !== 'string' || name.length > 80)
      || !['', '本校', '南教室'].includes(campus)
      || (answerId && !/^[a-f0-9-]{36}$/i.test(answerId))
      || kind === 'generate' && (!selectedMaterialIds || selectedMaterialIds.length < 1
        || selectedMaterialIds.length > 300 || selectedMaterialIds.some(id => typeof id !== 'string' || !/^[a-z0-9:-]{1,64}$/.test(id))
        || new Set(selectedMaterialIds).size !== selectedMaterialIds.length))
      throw new InterviewError('入力内容を確認してください。', 400);
    const state = await loadInterviewState(context.dataClient);
    const student = state.students.find(row => String(row.student_number) === number && row.enrollment_status === 'current_roster');
    if (!student || !/^(小[4-6]|中[1-3])$/.test(String(student.grade || ''))) throw new InterviewError('生徒を確認してください。', 404);
    const { data: workers, error: workerError } = await context.dataClient.from('interview_material_workers')
      .select('ready,last_seen_at');
    if (workerError) throw workerError;
    if (!(workers || []).some(online)) throw new InterviewError('作成PCは停止中です。起動後にもう一度お試しください。', 503);
    let survey;
    if (kind === 'generate' && answerId && selectedMaterialIds?.includes('survey')) {
      try { survey = await loadVerifiedSurveyAnswer(answerId, student, state.students); }
      catch { throw new InterviewError('選択したアンケート回答を確認できませんでした。回答を選び直して、もう一度お試しください。', 409); }
    }
    const payload = { number, name: String(student.student_name), grade: String(student.grade), campus,
      schools: schools.map(name => String(name).trim()).filter(Boolean),
      ...(kind === 'preview' ? { surveyExpected: Boolean(answerId) } : { selectedMaterialIds: selectedMaterialIds || [] }),
      ...(survey ? { survey } : {}) };
    const { data: job, error } = await context.dataClient.from('interview_material_jobs')
      .insert({ kind, staff_code: context.staff.staffCode, payload }).select('id').single();
    if (error) throw error;
    return staffResponse({ id: job.id }, context, 201);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
