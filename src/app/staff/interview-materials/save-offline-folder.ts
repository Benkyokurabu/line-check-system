type WritableFile = { write(data: Blob | string): Promise<void>; close(): Promise<void> };
type FileHandle = { createWritable(): Promise<WritableFile> };
type DirectoryHandle = {
  getDirectoryHandle(name: string, options: { create: true }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options: { create: true }): Promise<FileHandle>;
};
type DirectoryPicker = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite'; startIn: 'downloads'; id: string }) => Promise<DirectoryHandle>;
};
type Material = { label: string; previewUrl?: string };

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
  jobId: string, studentNumber: string, studentName: string, onProgress: (message: string) => void,
): Promise<string> {
  const pick = (window as DirectoryPicker).showDirectoryPicker;
  if (!pick) throw Error('フォルダ保存はChromeまたはEdgeで利用できます。');
  // The picker must be the first asynchronous action after the button click.
  const parent = await pick({ mode: 'readwrite', startIn: 'downloads', id: 'interview-material-folder' });
  onProgress('資料を確認しています…');
  const [jobResponse, templateResponse] = await Promise.all([
    fetch(`/api/staff/interview-material-jobs?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' }),
    fetch('/interview-material-offline-template.html'),
  ]);
  if (!jobResponse.ok || !templateResponse.ok) throw Error('資料を取得できませんでした。もう一度お試しください。');
  const { job } = await jobResponse.json();
  const items = job?.result?.items as Material[] | undefined;
  if (job?.status !== 'completed' || !job.pdfUrl || !Array.isArray(items) || !items.length
    || items.some(item => !item.previewUrl)) throw Error('資料ごとのPDFがありません。資料を作成し直してください。');
  const template = await templateResponse.text();
  if (!template.includes('__ITEMS_JSON__') || !template.includes('__STUDENT_NAME_JSON__'))
    throw Error('面談用画面を作成できませんでした。');
  const html = template.replace('__ITEMS_JSON__', safeJson(items.map(item => ({ label: item.label }))))
    .replace('__STUDENT_NAME_JSON__', safeJson(studentName));
  if (!/^\d{5,12}$/.test(studentNumber)) throw Error('生徒番号を確認できませんでした。');
  const folderName = `面談資料_${studentNumber}_${jobId.slice(0, 8)}_${Date.now().toString(36)}`;
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
  await writeFile(folder, '面談資料.html', html);
  return folderName;
}
