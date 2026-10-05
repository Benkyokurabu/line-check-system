import { latestMaterialBatchAnswer, materialBatchAppointments, materialBatchMissing, sameMaterialAppointment } from '@/lib/interview-material-batch.mjs';
import { canonicalSchoolName } from '@/lib/interview-material-schools.mjs';
import { fetchMaterialContext, requestInfoSummary } from './material-context';
import { saveInterviewFolder, type DirectoryHandle, type MaterialAppointment } from './save-offline-folder';

type Answer = { id: string; date: string; schools: string[]; fields: { label: string; value: string }[] };
type Student = { number: string; name: string; grade: string; responses: Answer[] };
export type BatchFolderEntry = { appointment: MaterialAppointment; status: 'pending' | 'preview' | 'generate' | 'saving' | 'saved' | 'failed';
  message: string; path?: string; missing?: string[]; summaryMessage?: string };

async function jsonResponse(response: Response, fallback: string) {
  const body = await response.json();
  if (!response.ok) throw Error(body.error || fallback);
  return body;
}

async function createMaterialJob(payload: Record<string, unknown>) {
  const created = await jsonResponse(await fetch('/api/staff/interview-material-jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(65000),
  }), '作成依頼を登録できません。');
  if (typeof created.id !== 'string' || !created.id) throw Error('作成依頼の番号を確認できません。');
  for (let attempt = 0; attempt < 300; attempt++) {
    if (attempt) await new Promise(resolve => window.setTimeout(resolve, 2000));
    const body = await jsonResponse(await fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(created.id)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(30000) }), '作成状況を確認できません。');
    if (body.job?.status === 'completed') return { ...body.job, id: created.id };
    if (body.job?.status === 'failed') throw Error(body.job.error || '作成PCで処理できませんでした。');
  }
  throw Error('作成PCの処理が時間切れになりました。結果を確認して再試行してください。');
}

export async function runInterviewFolderBatch({ date, teacherId, appointments, targets, parent, onEntry, shouldStop }: {
  date: string; teacherId: string; appointments: MaterialAppointment[]; targets: MaterialAppointment[]; parent: DirectoryHandle;
  onEntry: (entry: BatchFolderEntry) => void; shouldStop: () => boolean;
}) {
  // Check the complete selected day's roster before starting even a single generation job.
  const [latest, roster] = await Promise.all([
    fetch(`/api/staff/interview-material-appointments?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal: AbortSignal.timeout(65000) })
      .then(response => jsonResponse(response, 'Notionの予定を再確認できません。')),
    fetch('/api/staff/interview-materials', { cache: 'no-store', signal: AbortSignal.timeout(65000) })
      .then(response => jsonResponse(response, '生徒とアンケートを再確認できません。')),
  ]);
  if (latest.source !== 'notion-bensuke' || !Array.isArray(latest.appointments) || !Array.isArray(roster.students))
    throw Error('Notionの予定または生徒台帳を確認できません。');
  const expected = materialBatchAppointments(appointments, date, teacherId) as MaterialAppointment[];
  const current = materialBatchAppointments(latest.appointments, date, teacherId) as MaterialAppointment[];
  if (!expected.length || current.length !== expected.length
    || expected.some(row => !current.some(fresh => sameMaterialAppointment(row, fresh)))
    || !targets.length || targets.some(row => !expected.some(original => sameMaterialAppointment(row, original))))
    throw Error('面談予定が変更されました。「Notionの予定を再取得」で対象一覧を確認し直してください。');
  const students = roster.students as Student[];
  for (const appointment of targets) {
    if (shouldStop()) break;
    const progress = (status: BatchFolderEntry['status'], message: string) => onEntry({ appointment, status, message });
    try {
      const matches = students.filter(student => student.number === appointment.number
        && student.name === appointment.name && student.grade === appointment.grade);
      if (matches.length !== 1) throw Error('面談予定の生徒と現在の台帳が一致しません。');
      const student = matches[0];
      const answer = latestMaterialBatchAnswer(student.responses) as Answer | null;
      progress('preview', '面談記録・本人の資料を確認中…');
      let context = await fetchMaterialContext(student.number, AbortSignal.timeout(65000));
      if (['prepared', 'failed'].includes(context.summary.status)) {
        try { await requestInfoSummary(student.number); context = { ...context, summary: { ...context.summary, status: 'queued' } }; }
        catch { /* Originals are mandatory; optional AI completion must not prevent saving. */ }
      }
      const schools = [...new Set((answer?.schools ?? []).map(name => canonicalSchoolName(name)).filter(Boolean))].slice(0, 6);
      const campusValue = answer?.fields.find(field => field.label === '所属校舎')?.value.trim();
      const campus = ['本校', '南教室'].includes(campusValue ?? '') ? campusValue : '';
      const payload = { number: student.number, schools, campus, ...(answer ? { answerId: answer.id } : {}) };
      const preview = await createMaterialJob({ ...payload, kind: 'preview' });
      if (preview.result?.hokushin?.indexing)
        throw Error(preview.result.hokushin.message || '北辰の索引を作成中です。作成PCの処理完了後に再試行してください。');
      const materials = preview.result?.materials as { id: string }[] | undefined;
      if (!Array.isArray(materials) || !materials.length) throw Error('保存できる資料がありません。作成PCの資料を確認してください。');
      progress('generate', '見つかった資料一式のPDFを作成中…');
      const generated = await createMaterialJob({ ...payload, kind: 'generate',
        schools: Array.isArray(preview.result?.schools) ? preview.result.schools.map((school: { name: string }) => school.name) : schools,
        selectedMaterialIds: materials.map(item => item.id) });
      let savedEntry: BatchFolderEntry | null = null;
      let summaryMessage = '';
      const path = await saveInterviewFolder(generated.id, student.number, student.name, student.grade, context,
        message => progress('saving', message), student.grade === '中2' && !schools.length,
        message => { summaryMessage = message; if (savedEntry) { savedEntry = { ...savedEntry, summaryMessage }; onEntry(savedEntry); } }, appointment, parent);
      const missing = materialBatchMissing(preview.result, student.grade,
        Array.isArray(generated.result?.missing) ? generated.result.missing : []) as string[];
      savedEntry = { appointment, status: 'saved', message: missing.length ? '保存済み（未取得の資料あり）' : '保存済み', path, missing, summaryMessage };
      onEntry(savedEntry);
    } catch (error) {
      progress('failed', error instanceof Error ? error.message : '保存できませんでした。');
    }
  }
}
