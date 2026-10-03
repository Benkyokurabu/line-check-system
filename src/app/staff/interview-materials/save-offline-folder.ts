import { materialDockLabel } from './material-dock-label';
import { fetchInfoSummary, fetchMaterialContext, requestInfoSummary, type MaterialContext } from './material-context';
import { fetchSchoolLibrary } from './school-library';

type WritableFile = { write(data: Blob | string): Promise<void>; close(): Promise<void> };
type FileHandle = { createWritable(): Promise<WritableFile>; getFile(): Promise<Blob> };
type SavedFolderInfo = { studentNumber: string; saveId: string; sourceHash: string; context: MaterialContext; showPastSchools: boolean };
type DirectoryHandle = {
  getDirectoryHandle(name: string, options: { create: true }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>;
};
type DirectoryPicker = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite'; startIn: 'downloads'; id: string }) => Promise<DirectoryHandle>;
};
type Material = { label: string; source?: string; previewUrl?: string };

export const canSaveOfflineFolder = () => typeof window !== 'undefined'
  && typeof (window as DirectoryPicker).showDirectoryPicker === 'function';

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
      if (summary.status === 'failed') { onProgress?.('資料は利用できます。AI要約は失敗しました。「保存済みフォルダのAI要約を更新」で再依頼できます。'); return; }
    } catch { /* Keep the complete saved folder usable and retry without duplicate writes. */ }
    if (Date.now() < expires) window.setTimeout(() => { void poll(); }, 3000);
    else onProgress?.('資料は保存済みです。AI要約の自動追記を終了しました。後から「保存済みフォルダのAI要約を更新」で追加できます。');
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
    onProgress('AI要約を保存済みフォルダに追加しました。PDFを保存し直す必要はありません。');
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
  jobId: string, studentNumber: string, studentName: string, _studentGrade: string, previousContext: MaterialContext | null,
  onProgress: (message: string) => void, showPastSchools = false,
  onSummaryProgress?: (message: string) => void
): Promise<string> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  // The picker must be the first asynchronous action after the button click.
  const parent = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'interview-material-folder' });
  onProgress('資料を確認しています…');
  const [jobResponse, templateResponse, details, schoolLibrary] = await Promise.all([
    fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' }),
    fetch('/interview-material-offline-template.html'),
    snapshotMaterialContext(studentNumber, previousContext),
    fetchSchoolLibrary(AbortSignal.timeout(65000)),
  ]);
  if (!jobResponse.ok || !templateResponse.ok) throw Error('資料を取得できませんでした。もう一度お試しください。');
  const { job } = await jobResponse.json();
  const items = job?.result?.items as Material[] | undefined;
  if (job?.status !== 'completed' || !job.pdfUrl || !Array.isArray(items) || !items.length
    || items.some(item => !item.previewUrl)) throw Error('資料ごとのPDFがありません。資料を作成し直してください。');
  const template = await templateResponse.text();
  if (!template.includes('__ITEMS_JSON__') || !template.includes('__STUDENT_NAME_JSON__') || !template.includes('__CONTEXT_JSON__'))
    throw Error('面談用画面を作成できませんでした。');
  const html = template.replace('__ITEMS_JSON__', safeJson(items.map(item => ({ label: item.label, kind: materialDockLabel(item) }))))
    .replace('__STUDENT_NAME_JSON__', safeJson(studentName)).replace('__CONTEXT_JSON__', safeJson({ ...details, showPastSchools,
      schoolLibrary: schoolLibrary.map(school => ({ id: school.id, school: school.school, reading: school.reading,
        category: school.category, year: school.year, file: `hokushin-${school.id}.pdf` })) }));
  if (!/^\d{5,12}$/.test(studentNumber)) throw Error('生徒番号を確認できませんでした。');
  const folderPart = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 60);
  const folderName = `${folderPart(studentName) || '氏名不明'}_${studentNumber}`;
  const files = [{ name: 'staff-bundle.pdf', label: '印刷用の一式PDF', url: job.pdfUrl },
    ...items.map((item, index) => ({ name: `material-${index}.pdf`, label: item.label, url: item.previewUrl! })),
    ...schoolLibrary.map(school => ({ name: `hokushin-${school.id}.pdf`, label: `${school.school}の北辰基礎資料`, url: school.previewUrl }))];
  // Download and validate every PDF before touching a previously saved student folder.
  const pdfs: Blob[] = new Array(files.length);
  let next = 0;
  let saved = 0;
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      try { pdfs[index] = await fetchPdf(file.url); }
      catch { throw Error(`「${file.label}」を取得できませんでした。フォルダ保存をもう一度お試しください。`); }
      saved++;
      onProgress(`PDFを取得しています… ${saved}/${files.length}`);
    }
  }));
  const folder = await parent.getDirectoryHandle(folderName, { create: true });
  for (let index = 0; index < files.length; index++) {
    onProgress(`ファイルを保存・確認しています… ${index + 1}/${files.length}`);
    await writeFile(folder, files[index].name, pdfs[index]);
  }
  await writeFile(folder, '面談記録.txt', recordText(details));
  await writeFile(folder, '生徒情報・注意点.txt', informationText(details, showPastSchools));
  await writeFile(folder, '資料一覧.txt', ['面談資料.html：面談中はこのファイルを開く（保存後はネット接続不要）',
    'staff-bundle.pdf：印刷用の一式PDF',
    ...items.map((item, index) => `material-${index}.pdf：${item.label}`),
    ...schoolLibrary.map(school => `hokushin-${school.id}.pdf：${school.school} ／ ${school.year}年度 北辰基礎資料`),
    '面談記録.txt：Notionの直近3回の面談記録の全文',
    '生徒情報・注意点.txt：生徒情報とAIによる確認点'].join('\n'));
  const savedInfo: SavedFolderInfo = { studentNumber, saveId: crypto.randomUUID(), sourceHash: details.summary.sourceHash || '', context: details, showPastSchools };
  await writeFile(folder, '保存情報.json', JSON.stringify(savedInfo));
  await writeFile(folder, 'AI要約.js', summaryScript(savedInfo));
  await writeFile(folder, '面談資料.html', html);
  watchSummary(folder, savedInfo, onSummaryProgress);
  return folderName;
}
