import { NextRequest } from 'next/server';
import { assertStaffMutationOrigin, staffContext, staffErrorResponse, staffJsonBody, staffResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { online } from '@/lib/interview-material-worker';
import { loadInterviewMaterialAppointments } from '@/lib/interview-material-appointments-loader';
import { futureMaterialAppointment, tokyoMaterialNow } from '@/lib/interview-material-daily-core.mjs';
import { materialRunDates, materialRunJobs } from '@/lib/interview-material-run-core.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function contextFor(request: NextRequest) {
  const context = await staffContext(request);
  if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
  return context;
}
async function workersFor(client: Awaited<ReturnType<typeof staffContext>>['dataClient']) {
  const { data, error } = await client.from('interview_material_workers').select('id,priority,ready,last_seen_at,status').order('priority');
  if (error) throw error;
  return (data ?? []).filter(worker => online(worker) && worker.status?.capabilities?.includes('daily-offline-v1'))
    .map(worker => ({ id: worker.id, name: worker.priority === 1 ? '主担当PC' : '予備PC' }));
}
export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof contextFor>> | undefined;
  try {
    context = await contextFor(request);
    const [workers, jobs] = await Promise.all([workersFor(context.dataClient), context.dataClient.from('interview_material_jobs')
      .select('id,status,payload,result,error,attempts,created_at').eq('staff_code', context.staff.staffCode)
      .eq('payload->autoDaily->>manual', 'true').gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(300)]);
    if (jobs.error) throw jobs.error;
    return staffResponse({ workers, jobs: (jobs.data ?? []).map(job => ({ id: job.id, status: job.status,
      appointment: job.payload.autoDaily.appointment, savedFolder: job.result?.savedFolder,
      skipped: job.result?.skipped === true, missing: job.result?.missing ?? [], error: job.error, attempts: job.attempts })) }, context);
  } catch (error) { return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context); }
}
export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof contextFor>> | undefined;
  try {
    assertStaffMutationOrigin(request);
    context = await contextFor(request);
    const client = context.dataClient;
    const body = await staffJsonBody(request);
    const runId = String(body.runId || ''), teacherId = String(body.teacherId || '');
    if (!/^[a-f0-9-]{36}$/i.test(runId) || teacherId && !/^[a-f0-9-]{32,36}$/i.test(teacherId)) throw new InterviewError('入力内容を確認してください。', 400);
    let dates;
    try { dates = materialRunDates(body.from, body.to, tokyoMaterialNow().date); }
    catch (error) { throw new InterviewError((error as Error).message, 400); }
    const workers = await workersFor(context.dataClient);
    if (!workers.length) throw new InterviewError('一括作成に対応したPCが停止中です。作成PCのアプリとNAS接続を確認してください。', 503);
    const planned = [];
    const deadline = AbortSignal.timeout(55000);
    for (let index = 0; index < dates.length; index += 2) planned.push(...await Promise.all(
      dates.slice(index, index + 2).map(date => loadInterviewMaterialAppointments(client, date, deadline))));
    const appointments = planned.flatMap(day => day.appointments).filter(row => futureMaterialAppointment(row));
    let jobs;
    try { jobs = materialRunJobs(appointments, { runId, staffCode: context.staff.staffCode, teacherId, from: dates[0], to: dates.at(-1) }); }
    catch (error) { throw new InterviewError((error as Error).message, 400); }
    if (jobs.length) {
      const { error } = await context.dataClient.from('interview_material_jobs').upsert(jobs, { onConflict: 'daily_key', ignoreDuplicates: true });
      if (error) throw error;
    }
    return staffResponse({ accepted: jobs.length, worker: workers[0].name,
      reviewCount: planned.reduce((count, day) => count + day.review.length, 0) }, context, 201);
  } catch (error) {
    if (error instanceof InterviewError) return staffResponse({ error: error.message }, context, error.status);
    if (context) return staffResponse({ error: '確定面談の取得または作成依頼の保存に失敗しました。資料作成は受け付けていません。再試行してください。' }, context, 503);
    return staffErrorResponse(error, context);
  }
}
