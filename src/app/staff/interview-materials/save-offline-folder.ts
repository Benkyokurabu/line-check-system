import { materialDockLabel } from './material-dock-label';
import { fetchInfoSummary, fetchMaterialContext, requestInfoSummary, type MaterialContext } from './material-context';

type WritableFile = { write(data: Blob | string): Promise<void>; close(): Promise<void> };
type FileHandle = { createWritable(): Promise<WritableFile>; getFile(): Promise<Blob> };
type DirectoryHandle = {
  getDirectoryHandle(name: string, options: { create: true }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options: { create: true }): Promise<FileHandle>;
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

async function completeMaterialContext(number: string): Promise<MaterialContext> {
  let details = await fetchMaterialContext(number);
  if (details.summary.status === 'prepared') await requestInfoSummary(number);
  for (let attempt = 0; attempt < 12 && ['prepared', 'queued', 'running'].includes(details.summary.status); attempt++) {
    if (attempt) await new Promise(resolve => window.setTimeout(resolve, 5000));
    const summary = await fetchInfoSummary(number);
    if (details.summary.sourceHash && summary.sourceHash && details.summary.sourceHash !== summary.sourceHash)
      throw Error('面談記録が更新されました。資料を開き直して保存してください。');
    details = { ...details, summary };
  }
  if (details.summary.status !== 'completed' && details.summary.status !== 'empty')
    throw Error('AIによる注意点の確認が完了していません。少し待ってから保存し直してください。');
  return details;
}

function recordText(context: MaterialContext) {
  return ['Notionの直近3回の面談記録（保存時点）', ...context.records.map(record =>
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

async function fetchPdf(url: string): Promise<Blob> {
  const response = await fetch(url);
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
  jobId: string, studentNumber: string, studentName: string, studentGrade: string, _context: MaterialContext | null,
  onProgress: (message: string) => void, showPastSchools = false,
): Promise<string> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  // The picker must be the first asynchronous action after the button click.
  const parent = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'interview-material-folder' });
  onProgress('資料を確認しています…');
  const [jobResponse, templateResponse, details] = await Promise.all([
    fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' }),
    fetch('/interview-material-offline-template.html'),
    completeMaterialContext(studentNumber),
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
    .replace('__STUDENT_NAME_JSON__', safeJson(studentName)).replace('__CONTEXT_JSON__', safeJson({ ...details, showPastSchools }));
  if (!/^\d{5,12}$/.test(studentNumber)) throw Error('生徒番号を確認できませんでした。');
  const folderPart = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 60);
  const folderName = `${folderPart(studentGrade) || '学年不明'}_${folderPart(studentName) || '氏名不明'}`;
  const folder = await parent.getDirectoryHandle(folderName, { create: true });
  const files = [{ name: 'staff-bundle.pdf', url: job.pdfUrl },
    ...items.map((item, index) => ({ name: `material-${index}.pdf`, url: item.previewUrl! }))];
  let next = 0;
  let saved = 0;
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      const pdf = await fetchPdf(file.url);
      await writeFile(folder, file.name, pdf);
      saved++;
      onProgress(`PDFを保存しています… ${saved}/${files.length}`);
    }
  }));
  await writeFile(folder, '面談記録.txt', recordText(details));
  await writeFile(folder, '生徒情報・注意点.txt', informationText(details, showPastSchools));
  await writeFile(folder, '資料一覧.txt', ['面談資料.html：資料の入口',
    'staff-bundle.pdf：印刷用の一式PDF',
    ...items.map((item, index) => `material-${index}.pdf：${item.label}`),
    '面談記録.txt：Notionの直近3回の面談記録の全文',
    '生徒情報・注意点.txt：生徒情報とAIによる確認点'].join('\n'));
  await writeFile(folder, '面談資料.html', html);
  return folderName;
}
