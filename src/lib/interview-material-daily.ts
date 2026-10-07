import type { SupabaseClient } from '@supabase/supabase-js';
import { loadInterviewMaterialAppointments } from './interview-material-appointments-loader';
import { loadInterviewMaterialContext } from './interview-material-context-loader';
import { loadMaterialStudents } from './interview-material-students';
import { loadInvitationSurveyResponses, loadVerifiedSurveyAnswer } from './interview-surveys-notion';
import { latestMaterialBatchAnswer, sameMaterialAppointment } from './interview-material-batch.mjs';
import { canonicalSchoolName, schoolsFromAnswer } from './interview-material-schools.mjs';
import { DailyMaterialError, dailyMaterialSourceHash, futureMaterialAppointment, verifiedDailyAppointment } from './interview-material-daily-core.mjs';
import { interviewMaterialFolderParts } from './interview-material-folder.mjs';
import { checkedPage } from './bensuke-booking.mjs';

type Appointment = { id: string; number: string; name: string; grade: string; teacher: string; teacherId: string;
  date: string; start: string; editedAt: string; source: string };

export async function scanDailyMaterials(client: SupabaseClient, workerId: string) {
  const { data: scan, error } = await client.rpc('interview_material_daily_scan_claim', { p_worker: workerId });
  if (error) throw error;
  if (!scan) return { ok: true, scheduled: 0 };
  try {
    const result = await loadInterviewMaterialAppointments(client, scan.date);
    const current = result.appointments as Appointment[];
    const targets = current.filter(row => futureMaterialAppointment(row));
    let scheduled = 0;
    for (const appointment of targets) {
      const dailyKey = `${scan.runDate}:${appointment.id}:${appointment.number}`;
      const { error: insertError } = await client.from('interview_material_jobs').upsert({
        daily_key: dailyKey, kind: 'generate', staff_code: '__daily_materials__',
        payload: { number: appointment.number, name: appointment.name, grade: appointment.grade, schools: [], campus: '',
          autoDaily: { appointment } },
      }, { onConflict: 'daily_key', ignoreDuplicates: true });
      if (insertError) throw insertError;
      scheduled++;
    }
    const { data: previous, error: previousError } = await client.from('interview_material_jobs')
      .select('id,status,payload').not('daily_key', 'is', null).eq('payload->autoDaily->appointment->>date', scan.date);
    if (previousError) throw previousError;
    const changed = (previous ?? []).filter(job => !current.some(row => sameMaterialAppointment(row, job.payload?.autoDaily?.appointment)))
      .map(job => ({ id: job.id, appointment: job.payload.autoDaily.appointment,
        message: '予定取消・対象変更。以前の保存資料は保持しています。' }));
    const report = { scheduled, review: result.review, changed, checkedAt: new Date().toISOString() };
    const { error: finishError } = await client.from('interview_material_daily_scans').update({ status: 'completed', report,
      lease_until: null, updated_at: new Date().toISOString() }).eq('run_date', scan.runDate).eq('target_date', scan.date)
      .eq('worker_id', workerId).eq('lease', scan.lease);
    if (finishError) throw finishError;
    // Heartbeats must stay small; full review and change details live in the staff-only scan report.
    return { ok: true, scheduled, date: scan.date, reviewCount: result.review.length,
      changedCount: changed.length, checkedAt: report.checkedAt };
  } catch (caught) {
    await client.from('interview_material_daily_scans').update({ status: 'failed', lease_until: null,
      error: caught instanceof Error ? caught.message.slice(0, 300) : '巡回に失敗しました。', updated_at: new Date().toISOString() })
      .eq('run_date', scan.runDate).eq('target_date', scan.date).eq('worker_id', workerId).eq('lease', scan.lease);
    throw caught;
  }
}

/** Reads the same identity-checked originals used by the interactive folder saver. */
export async function prepareDailyMaterials(client: SupabaseClient, expected: Appointment, manual = false) {
  const { data: settings, error: settingsError } = await client.from('interview_material_daily_settings').select('enabled').eq('id', true).single();
  if (settingsError) throw settingsError;
  if (!settings.enabled && !manual) throw new DailyMaterialError('自動作成は停止中です。以前の資料は保持しています。');
  const [planned, students] = await Promise.all([loadInterviewMaterialAppointments(client, expected.date), loadMaterialStudents(client)]);
  verifiedDailyAppointment(expected, planned.appointments);
  const matching = students.filter(row => String(row.student_number) === expected.number
    && row.student_name === expected.name && row.grade === expected.grade);
  if (matching.length !== 1) throw new DailyMaterialError('面談予定と現在の生徒台帳が一致しません。');
  const [responses, context] = await Promise.all([
    loadInvitationSurveyResponses(students, [expected.grade]), loadInterviewMaterialContext(client, expected.number),
  ]);
  const summaryHash = 'sourceHash' in context.summary ? context.summary.sourceHash : '';
  if (['prepared', 'failed'].includes(context.summary.status) && summaryHash) {
    // Optional AI enrichment shares the existing worker; complete originals never wait for it.
    const { error: summaryError } = await client.from('interview_material_info_summaries').update({ requested: true,
      status: 'queued', attempts: 0, error: null, claimed_at: null, updated_at: new Date().toISOString() })
      .eq('student_number', expected.number).eq('source_hash', summaryHash).neq('status', 'running');
    if (summaryError) console.error('Optional daily interview summary request failed', summaryError.message);
  }
  const candidates = responses.rows.filter(row => row.link_status === 'linked' && String(row.student_number) === expected.number)
    .map(row => ({ id: String(row.page_id), date: String(row.answered_at ?? '') }));
  let latest: { id: string } | null;
  try { latest = latestMaterialBatchAnswer(candidates) as { id: string } | null; }
  catch { throw new DailyMaterialError('最新のアンケート回答を特定できません。回答を個別に確認してください。以前の資料は保持しています。'); }
  const survey = latest ? await loadVerifiedSurveyAnswer(latest.id, matching[0], students) : null;
  const fields = survey?.fields as Array<{ label: string; value: string }> | undefined;
  const schools = [...new Set(schoolsFromAnswer(fields ?? []).map((name: string) => canonicalSchoolName(name)).filter(Boolean))].slice(0, 6);
  const campusValue = fields?.find(field => field.label === '所属校舎')?.value.trim();
  const payload = { number: expected.number, name: expected.name, grade: expected.grade,
    schools, campus: ['本校', '南教室'].includes(campusValue ?? '') ? campusValue : '', surveyExpected: Boolean(survey),
    ...(survey ? { survey } : {}) };
  const finalPage = await checkedPage(planned.read, expected.id, planned.sourceId);
  if (finalPage.last_edited_time !== expected.editedAt) throw new DailyMaterialError('確認中にNotionの面談予定が更新されました。以前の資料は保持しています。');
  verifiedDailyAppointment(expected, planned.appointments);
  return { appointment: expected, payload, context, folderParts: interviewMaterialFolderParts(expected),
    sourceHash: dailyMaterialSourceHash(expected, payload, context) };
}
