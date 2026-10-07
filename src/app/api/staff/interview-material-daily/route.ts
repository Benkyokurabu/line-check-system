import { NextRequest } from 'next/server';
import { staffContext, staffResponse, staffErrorResponse } from '@/lib/staff-auth-http';
import { InterviewError } from '@/lib/interview-core.mjs';
import { tokyoMaterialNow } from '@/lib/interview-material-daily-core.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await staffContext(request);
    if (!['admin', 'office', 'employee', 'teacher'].includes(context.staff.role)) throw new InterviewError('職員の権限を確認してください。', 403);
    const today = tokyoMaterialNow().date;
    const [settings, scans, jobs] = await Promise.all([
      context.dataClient.from('interview_material_daily_settings').select('enabled,run_time,days_ahead').eq('id', true).maybeSingle(),
      context.dataClient.from('interview_material_daily_scans').select('run_date,target_date,status,report,error,updated_at')
        .gte('run_date', today).order('target_date'),
      context.dataClient.from('interview_material_jobs').select('id,status,payload,result,error,attempts,completed_at,created_at')
        .not('daily_key', 'is', null).gte('created_at', `${today}T00:00:00+09:00`).order('created_at'),
    ]);
    if (settings.error || scans.error || jobs.error) throw Error('自動作成の状況を取得できません。');
    return staffResponse({ settings: settings.data, scans: scans.data, jobs: (jobs.data ?? []).map(job => ({
      id: job.id, status: job.status, appointment: job.payload.autoDaily.appointment, attempts: job.attempts,
      savedFolder: job.result?.savedFolder, skipped: job.result?.skipped === true, missing: job.result?.missing ?? [],
      error: job.error, completedAt: job.completed_at,
    })) }, context);
  } catch (error) {
    return error instanceof InterviewError ? staffResponse({ error: error.message }, context, error.status) : staffErrorResponse(error, context);
  }
}
