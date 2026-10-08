import { materialDockLabel } from './material-dock-label';
import { fetchInfoSummary, fetchMaterialContext, requestInfoSummary, type MaterialContext } from './material-context';
import { fetchSchoolLibrary } from './school-library';
import { renderOfflineSchoolLibrary } from '@/lib/hokushin-school-library.mjs';
import { individualInterviewMaterialFolderParts, interviewMaterialFolderParts } from '@/lib/interview-material-folder.mjs';

type WritableFile = { write(data: Blob | string): Promise<void>; close(): Promise<void> };
type FileHandle = { createWritable(): Promise<WritableFile>; getFile(): Promise<Blob> };
type SavedFolderInfo = { studentNumber: string; saveId: string; sourceHash: string; context: MaterialContext; showPastSchools: boolean; appointment?: MaterialAppointment };
export type DirectoryHandle = {
  name: string;
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>;
};
type DirectoryPicker = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite'; startIn: 'downloads'; id: string }) => Promise<DirectoryHandle>;
};
type Material = { label: string; source?: string; previewUrl?: string };
export type MaterialAppointment = { id: string; number: string; name: string; grade: string; teacher: string; teacherId: string;
  date: string; start: string; editedAt: string; url: string; source: 'notion-bensuke' };
export const interviewMaterialsSharePath = '\\\\TS3210\\benko\\03 教務部\\015 各面談行事／文化会館も含む\\98面談資料';

export const canSaveOfflineFolder = () => typeof window !== 'undefined'
  && typeof (window as DirectoryPicker).showDirectoryPicker === 'function';

export async function pickInterviewMaterialsFolder(): Promise<DirectoryHandle> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  const folder = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'interview-material-folder' });
  if (folder.name !== '98面談資料') throw Error('保存先には共有フォルダ「98面談資料」を選んでください。');
  return folder;
}

const safeJson = (value: unknown) => JSON.stringify(value)
  .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

async function writeFile(folder: DirectoryHandle, name: string, contents: Blob | string) {
  const file = await folder.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(contents);
  await writable.close();
  const saved = await file.getFile();
  const expectedSize = typeof contents === 'string' ? new Blob([contents]).size : contents.size;
  if (saved.size !== expectedSize) throw Error(`${name}を完全に保存できませんでした。`);
}

/** AI enrichment is optional. Required records and student information must still load in full. */
async function snapshotMaterialContext(number: string, previous: MaterialContext | null): Promise<MaterialContext> {
  // Reuse the snapshot already shown for this student for two minutes; otherwise refresh in full.
  const fresh = previous?.studentNumber === number && previous.capturedAt
    && Date.now() - Date.parse(previous.capturedAt) >= 0 && Date.now() - Date.parse(previous.capturedAt) < 120000;
  const details = fresh ? previous : await fetchMaterialContext(number, AbortSignal.timeout(65000));
  if (['completed', 'empty'].includes(details.summary.status)) return details;
  if (previous?.summary.status === 'completed' && details.summary.sourceHash
    && previous.summary.sourceHash === details.summary.sourceHash) return { ...details, summary: previous.summary };
  try {
    const summary = await fetchInfoSummary(number, AbortSignal.timeout(3000));
    // Never attach a summary extracted from different source records.
    if (summary.status === 'completed' && details.summary.sourceHash
      && summary.sourceHash === details.summary.sourceHash) return { ...details, summary };
  } catch { /* Save the complete originals even if the optional AI service is unavailable. */ }
  return details;
}

function recordText(context: MaterialContext) {
  return ['Notionの直近3回の面談記録（取得時点）', `取得日時：${context.capturedAt || '記録なし'}`,  ...context.records.map(record =>
    `${record.date || '日付なし'}　${record.title}\n方法：${record.method || '記載なし'} ／ 目的：${record.purpose || '記載なし'}\n原本：${record.url}\n\n${record.body || '本文なし'}${record.attachments?.length ? `\n\n添付ファイル：${record.attachments.join('、')}（原本から確認）` : ''}`)].join('\n\n━━━━━━━━━━━━━━━━\n\n');
}

function informationText(context: MaterialContext, showPastSchools = false) {
  const notes = context.summary.status === 'completed'
    ? context.summary.items.map(item => `・${item.note}\n  出典：${item.source}`)
    : ['AIによる注意点の抽出は保存時点で完了していません。面談記録と生徒情報の原文を確認してください。'];
  const schools = showPastSchools ? ['過去の面談で話題に出た高校（志望校として未確定）',
    ...(context.schoolMentions?.length ? context.schoolMentions.map(item => `${item.text}\n${item.date || '日付なし'}・${item.url}`) : ['高校名への言及なし']), ''] : [];
  return [...schools, '面談前に確認したい点（AI）', ...(notes.length ? notes : ['特記する項目なし']),
    '', '生徒情報DBの原文', ...context.info.map(item => `${item.source}\n${item.value}`)].join('\n\n');
}

function summaryScript(saved: SavedFolderInfo, summary = saved.context.summary) {
  return `window.__INTERVIEW_AI_SNAPSHOT__ = ${safeJson({ saveId: saved.saveId, sourceHash: saved.sourceHash, summary })};`;
}
async function writeSummary(folder: DirectoryHandle, saved: SavedFolderInfo, summary: MaterialContext['summary']) {
  const current = await (await folder.getFileHandle('AI要約.js', { create: false })).getFile();
  if (!(await current.text()).includes(`"saveId":${safeJson(saved.saveId)}`)) return false;
  await writeFile(folder, '生徒情報・注意点.txt', informationText({ ...saved.context, summary }, saved.showPastSchools));
  await writeFile(folder, 'AI要約.js', summaryScript(saved, summary));
  return true;
}
function watchSummary(folder: DirectoryHandle, saved: SavedFolderInfo, onProgress?: (message: string) => void) {
  if (!saved.sourceHash || !['prepared', 'queued', 'running'].includes(saved.context.summary.status)) return;
  const expires = Date.now() + 10 * 60_000;
  onProgress?.('資料一式は保存済みです。AI要約は完成後、このフォルダへ自動で追加します。勉たんのタブを開いたままにしてください。');
  const poll = async () => {
    try {
      const summary = await fetchInfoSummary(saved.studentNumber, AbortSignal.timeout(10000));
      if (summary.sourceHash !== saved.sourceHash) {
        onProgress?.('元の記録が更新されたため、AIの自動追記を停止しました。最新の資料を保存してください。'); return;
      }
      if (summary.status === 'completed') {
        const updated = await writeSummary(folder, saved, summary);
        if (updated) onProgress?.('AI要約を同じフォルダに追加しました。開いている面談資料.htmlにも反映されます。');
        return;
      }
      if (summary.status === 'failed') { onProgress?.('資料は利用できます。AI要約は失敗しました。「生徒の保存済みフォルダを選んでAI要約を反映」で再依頼できます。'); return; }
    } catch { /* Keep the complete saved folder usable and retry without duplicate writes. */ }
    if (Date.now() < expires) window.setTimeout(() => { void poll(); }, 3000);
    else onProgress?.('資料は保存済みです。AI要約の自動追記を終了しました。後から「生徒の保存済みフォルダを選んでAI要約を反映」で追加できます。');
  };
  window.setTimeout(() => { void poll(); }, 3000);
}
export async function updateInterviewFolderSummary(studentNumber: string, onProgress: (message: string) => void) {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ更新はChromeまたはEdgeで利用できます。');
  const folder = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'interview-material-folder-update' });
  let saved: SavedFolderInfo;
  try { saved = JSON.parse(await (await (await folder.getFileHandle('保存情報.json', { create: false })).getFile()).text()); }
  catch { throw Error('保存した生徒名のフォルダを選んでください。「保存情報.json」が見つかりません。'); }
  if (saved.studentNumber !== studentNumber || !saved.saveId || !saved.context || !saved.sourceHash)
    throw Error('選んだフォルダの生徒または保存情報が一致しません。');
  let summary = await fetchInfoSummary(studentNumber, AbortSignal.timeout(10000));
  if (summary.sourceHash !== saved.sourceHash) throw Error('元の記録が更新されています。AI要約だけを追加せず、最新の面談フォルダを保存してください。');
  if (summary.status === 'completed') {
    if (!await writeSummary(folder, saved, summary)) throw Error('フォルダが更新されました。もう一度選んでください。');
    onProgress('保存済みフォルダの「AI要約.js」と「生徒情報・注意点.txt」を更新しました。PDFと面談資料.htmlを保存し直す必要はありません。');
  } else {
    if (['prepared', 'failed'].includes(summary.status)) { await requestInfoSummary(studentNumber); summary = { ...summary, status: 'queued' }; }
    watchSummary(folder, { ...saved, context: { ...saved.context, summary } }, onProgress);
  }
}

async function fetchPdf(url: string): Promise<Blob> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('PDFを取得できませんでした。');
  const pdf = await response.blob();
  if (await pdf.slice(0, 5).text() !== '%PDF-') throw Error('PDFの内容を確認できませんでした。');
  return pdf;
}

export async function downloadInterviewPdf(jobId: string, studentNumber: string): Promise<string> {
  if (!/^\d{5,12}$/.test(studentNumber)) throw Error('生徒番号を確認できませんでした。');
  const response = await fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!response.ok) throw Error('一式PDFを取得できませんでした。もう一度お試しください。');
  const { job } = await response.json();
  if (job?.status !== 'completed' || !job.pdfUrl) throw Error('一式PDFを取得できませんでした。資料を作成し直してください。');
  const pdf = await fetchPdf(job.pdfUrl);
  const name = `面談資料_${studentNumber}_${jobId.slice(0, 8)}.pdf`;
  const objectUrl = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  return name;
}

export async function saveInterviewFolder(
  jobId: string, studentNumber: string, studentName: string, studentGrade: string, previousContext: MaterialContext | null,
  onProgress: (message: string) => void, showPastSchools = false,
  onSummaryProgress?: (message: string) => void, appointment?: MaterialAppointment, batchParent?: DirectoryHandle
): Promise<string> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  if (batchParent && !appointment) throw Error('一括保存の面談予定を確認できません。');
  if (appointment && (appointment.number !== studentNumber || appointment.name !== studentName
    || appointment.source !== 'notion-bensuke' || !appointment.editedAt || !appointment.teacherId))
    throw Error('保存する生徒と面談予定が一致しません。');
  const folderParts = appointment ? interviewMaterialFolderParts(appointment)
    : individualInterviewMaterialFolderParts({ number: studentNumber, name: studentName, grade: studentGrade });
  // The picker must be the first asynchronous action after the button click.
  const parent = batchParent ?? await pickInterviewMaterialsFolder();
  if (parent.name !== '98面談資料') throw Error('保存先には共有フォルダ「98面談資料」を選んでください。');
  onProgress('資料を確認しています…');
  const [jobResponse, templateResponse, details] = await Promise.all([
    fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' }),
    fetch('/interview-material-offline-template.html'),
    snapshotMaterialContext(studentNumber, previousContext),
  ]);
  if (!jobResponse.ok || !templateResponse.ok) throw Error('資料を確認できませんでした。もう一度お試しください。');
  const { job } = await jobResponse.json();
  const items = job?.result?.items as Material[] | undefined;
  if (job?.status !== 'completed' || !job.pdfUrl || !Array.isArray(items) || !items.length
    || items.some(item => !item.previewUrl)) throw Error('資料ごとのPDFがありません。資料を作成し直してください。');
  const template = await templateResponse.text();
  if (!template.includes('__ITEMS_JSON__') || !template.includes('__STUDENT_NAME_JSON__') || !template.includes('__CONTEXT_JSON__'))
    throw Error('面談用画面を作成できませんでした。');
  const html = template.replace('__ITEMS_JSON__', safeJson(items.map(item => ({ label: item.label, kind: materialDockLabel(item) }))))
    .replace('__STUDENT_NAME_JSON__', safeJson(studentName)).replace('__CONTEXT_JSON__', safeJson({ ...details, showPastSchools }));
  if (!/^\d{5,12}$/.test(studentNumber)) throw Error('生徒番号を確認できませんでした。');
  const files = [{ name: 'staff-bundle.pdf', label: '印刷用の一式PDF', url: job.pdfUrl },
    ...items.map((item, index) => ({ name: `material-${index}.pdf`, label: item.label, url: item.previewUrl! }))];
  // Download and validate every PDF before touching a previously saved student folder.
  const pdfs: Blob[] = new Array(files.length);
  let next = 0;
  let saved = 0;
  const transfers = await Promise.allSettled(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      try { pdfs[index] = await fetchPdf(file.url); }
      catch { throw Error(`「${file.label}」を取得できませんでした。フォルダ保存をもう一度お試しください。`); }
      saved++;
      onProgress(`PDFを取得しています… ${saved}/${files.length}`);
    }
  }));
  const failedTransfer = transfers.find(result => result.status === 'rejected');
  if (failedTransfer?.status === 'rejected') throw failedTransfer.reason;
  // Recheck after PDF transfers, immediately before creating any destination.
  if (appointment) {
    onProgress('保存直前にNotionの面談予定を再確認しています…');
    const appointmentsResponse = await fetch(`/api/staff/interview-material-appointments?date=${encodeURIComponent(appointment.date)}&verify=${encodeURIComponent(appointment.id)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    const latest = await appointmentsResponse.json();
    if (!appointmentsResponse.ok) throw Error(latest.error || 'Notionの面談予定を再確認できませんでした。');
    const appointments = latest.appointments as MaterialAppointment[];
    if (latest.source !== 'notion-bensuke' || !appointments?.some(row =>
      (['id', 'number', 'name', 'grade', 'teacher', 'teacherId', 'date', 'start', 'editedAt', 'source'] as const)
        .every(field => row[field] === appointment[field])))
      throw Error('面談予定が変更されました。日付を選び直してから保存してください。');
  }
  let container = parent;
  for (const part of folderParts.slice(0, -1)) container = await container.getDirectoryHandle(part, { create: true });
  let leaf = folderParts[folderParts.length - 1];
  // Preserve every previous PDF and unknown file, including partial saves.
  try {
    await container.getDirectoryHandle(leaf, { create: false });
    leaf += `（再保存 ${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}_${crypto.randomUUID().slice(0, 8)}）`;
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  const folder = await container.getDirectoryHandle(leaf, { create: true });
  for (let index = 0; index < files.length; index++) {
    onProgress(`ファイルを保存・確認しています… ${index + 1}/${files.length}`);
    await writeFile(folder, files[index].name, pdfs[index]);
  }
  await writeFile(folder, '面談記録.txt', recordText(details));
  await writeFile(folder, '生徒情報・注意点.txt', informationText(details, showPastSchools));
  await writeFile(folder, '資料一覧.txt', ['面談資料.html：面談中はこのファイルを開く（保存後はネット接続不要）',
    'staff-bundle.pdf：印刷用の一式PDF',
    ...items.map((item, index) => `material-${index}.pdf：${item.label}`),
    '面談記録.txt：Notionの直近3回の面談記録の全文',
    '生徒情報・注意点.txt：生徒情報とAIによる確認点'].join('\n'));
  const savedInfo: SavedFolderInfo = { studentNumber, saveId: crypto.randomUUID(), sourceHash: details.summary.sourceHash || '', context: details, showPastSchools, appointment };
  await writeFile(folder, '保存情報.json', JSON.stringify(savedInfo));
  await writeFile(folder, 'AI要約.js', summaryScript(savedInfo));
  await writeFile(folder, '面談資料.html', html);
  watchSummary(folder, savedInfo, onSummaryProgress);
  return [...folderParts.slice(0, -1), leaf].join('／');
}

export async function saveSchoolLibraryFolder(onProgress: (message: string) => void): Promise<string> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  const parent = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'hokushin-school-library-folder' });
  onProgress('北辰基礎資料の学校一覧を確認しています…');
  const [schools, templateResponse] = await Promise.all([
    fetchSchoolLibrary(AbortSignal.timeout(65000)), fetch('/hokushin-school-library-template.html'),
  ]);
  if (!templateResponse.ok) throw Error('北辰基礎資料の閲覧画面を取得できませんでした。');
  const capturedAt = new Date().toISOString();
  const html = renderOfflineSchoolLibrary(await templateResponse.text(), schools, capturedAt);
  const folderName = '北辰基礎資料';
  let chosenLibrary = false;
  try {
    const saved = JSON.parse(await (await (await parent.getFileHandle('保存情報.json', { create: false })).getFile()).text());
    chosenLibrary = saved.kind === 'hokushin-school-library';
  } catch { /* A parent directory rather than an existing school library. */ }
  const folder = chosenLibrary ? parent : await parent.getDirectoryHandle(folderName, { create: true });
  const pdfFolder = await folder.getDirectoryHandle('pdf', { create: true });
  let next = 0, completed = 0, reused = 0, stopped = false;
  async function matches(pdf: Blob, school: typeof schools[number]) {
    if (pdf.size !== school.bytes || await pdf.slice(0, 5).text() !== '%PDF-') return false;
    const digest = await crypto.subtle.digest('SHA-256', await pdf.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === school.id;
  }
  // Immutable school PDFs can be saved a few at a time. Keep the previous HTML
  // untouched until every school is present, and reuse only verified local files.
  const transfers = await Promise.allSettled(Array.from({ length: Math.min(3, schools.length) }, async () => {
    while (!stopped && next < schools.length) {
      const school = schools[next++];
      const name = `${school.id}.pdf`;
      let existing: Blob | null = null;
      try { existing = await (await pdfFolder.getFileHandle(name, { create: false })).getFile(); } catch { /* New school PDF. */ }
      try {
        if (existing && await matches(existing, school)) reused++;
        else {
          const pdf = await fetchPdf(school.previewUrl);
          if (!await matches(pdf, school)) throw Error('PDFの内容が一致しません。');
          await writeFile(pdfFolder, name, pdf);
        }
        completed++;
        onProgress(`北辰基礎資料を保存・確認しています… ${completed}/${schools.length}件（保存済み再利用 ${reused}件）`);
      } catch {
        stopped = true;
        throw Error(`「${school.school}」を保存できませんでした。もう一度保存すると、確認済みのPDFは再利用します。`);
      }
    }
  }));
  const failed = transfers.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  await writeFile(folder, '保存情報.json', safeJson({ kind: 'hokushin-school-library', capturedAt,
    items: schools.map(({ id, school, reading, category, year, bytes }) => ({ id, school, reading, category, year, bytes })) }));
  await writeFile(folder, '使い方.txt', '「北辰基礎資料.html」を開くと、学校名で検索して全学校・学科の資料を閲覧できます。\n生徒の面談資料とは独立した共通資料です。\n別のPCへ移すときは、pdfフォルダを含む「北辰基礎資料」フォルダを丸ごとコピーしてください。\n');
  await writeFile(folder, '北辰基礎資料.html', html);
  return folderName;
}
