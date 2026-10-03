import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { renderOfflineSchoolLibrary } from '../../src/lib/hokushin-school-library.mjs';

const pdfA = '%PDF-1.4\nA\n%%EOF', pdfB = '%PDF-1.4\nB\n%%EOF';
const idA = createHash('sha256').update(pdfA).digest('hex'), idB = createHash('sha256').update(pdfB).digest('hex');
const schools = [
  { id: idA, school: '川口', reading: 'か川口', category: '公立', year: 2027, bytes: Buffer.byteLength(pdfA), previewUrl: 'https://example.com/school-a.pdf' },
  { id: idB, school: '川口北', reading: 'か川口北', category: '公立', year: 2027, bytes: Buffer.byteLength(pdfB), previewUrl: 'https://example.com/school-b.pdf' },
  { id: 'c'.repeat(64), school: '叡明', reading: 'え叡明', category: '私立', year: 2026, bytes: 100, previewUrl: 'https://example.com/school-c.pdf' },
];

for (const width of [390, 1365]) test(`standalone school HTML browses offline at ${width}px without student materials`, async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'bentan-hokushin-standalone-'));
  try {
    const template = await readFile('public/hokushin-school-library-template.html', 'utf8');
    await writeFile(join(directory, '北辰基礎資料.html'), renderOfflineSchoolLibrary(template, schools, '2026-10-03T12:00:00Z'), 'utf8');
    await page.setViewportSize({ width, height: 900 });
    const network: string[] = [];
    await page.route('https://**/*', route => { network.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(join(directory, '北辰基礎資料.html')).href);
    await expect(page.getByText('3件 / 全3件')).toBeVisible();
    await expect(page.getByText('面談記録', { exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: '学校名で検索' }).fill('川口');
    await expect(page.getByText('2件 / 全3件')).toBeVisible();
    await page.getByRole('button', { name: '川口の北辰基礎資料を表示' }).click();
    await expect(page.getByRole('button', { name: '← 前の資料' })).toBeDisabled();
    await expect(page.locator('iframe')).toHaveAttribute('src', `pdf/${idA}.pdf#zoom=100&navpanes=0`);
    await page.getByRole('button', { name: '次の資料 →' }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', `pdf/${idB}.pdf#zoom=100&navpanes=0`);
    await expect(page.getByRole('button', { name: '次の資料 →' })).toBeDisabled();
    await page.getByRole('button', { name: '← 学校の目次に戻る' }).click();
    await expect(page.getByRole('searchbox', { name: '学校名で検索' })).toHaveValue('川口');
    await expect(page.getByRole('button', { name: '川口北の北辰基礎資料を表示' })).toBeFocused();
    await page.getByRole('searchbox', { name: '学校名で検索' }).fill('');
    await page.getByRole('combobox', { name: '学校の種類' }).selectOption('私立');
    await expect(page.getByRole('button', { name: '叡明の北辰基礎資料を表示' })).toContainText('2026年度');
    await page.screenshot({ path: `analysis_outputs/hokushin-standalone-${width}.png` });
    expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
    expect(network).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('shared school folder saves independently, reuses verified PDFs and protects the previous HTML on failure', async ({ page }) => {
  let pdfReads = 0;
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [] } }));
  await page.route('**/api/staff/interview-material-context**', () => { throw Error('School folder must not request a student context'); });
  await page.route('**/api/staff/interview-material-school-library', route => route.fulfill({ json: { items: schools.slice(0, 2) } }));
  await page.route('https://example.com/school-*.pdf', route => {
    pdfReads++;
    return route.fulfill({ body: route.request().url().endsWith('school-a.pdf') ? pdfA : pdfB,
      contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.addInitScript(() => {
    const files: Record<string, string> = {};
    Object.defineProperty(window, '__schoolFiles', { value: files });
    const folder = (base: string): object => ({
      getDirectoryHandle: async (name: string) => folder(base ? `${base}/${name}` : name),
      getFileHandle: async (name: string, options: { create: boolean }) => {
        const key = base ? `${base}/${name}` : name;
        if (!options.create && files[key] === undefined) throw new DOMException('File missing', 'NotFoundError');
        return {
          getFile: async () => new Blob([files[key] ?? '']),
          createWritable: async () => ({ write: async (value: Blob | string) => { files[key] = typeof value === 'string' ? value : await value.text(); }, close: async () => {} }),
        };
      },
    });
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => folder((window as Window & { __schoolPickLibrary?: boolean }).__schoolPickLibrary ? '北辰基礎資料' : '') });
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: '北辰基礎資料を見る' }).click();
  await expect(page.getByRole('dialog', { name: '北辰基礎資料のプレビュー' }).getByText('2件 / 全2件')).toBeVisible();
  await page.getByRole('button', { name: '川口の北辰基礎資料を表示' }).click();
  await expect(page.getByTitle('川口の北辰基礎資料')).toHaveAttribute('src', 'https://example.com/school-a.pdf#zoom=100&navpanes=0');
  await page.getByRole('button', { name: '← 面談資料の画面に戻る' }).click();
  await expect(page.getByRole('button', { name: '北辰基礎資料を見る' })).toBeFocused();
  // The iframe preview made one request; count only the following folder downloads.
  pdfReads = 0;
  await page.getByRole('button', { name: '北辰用フォルダを保存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '「北辰基礎資料.html」を開けば' })).toBeVisible();
  expect(pdfReads).toBe(2);
  const saved = await page.evaluate(() => (window as unknown as Window & { __schoolFiles: Record<string, string> }).__schoolFiles);
  expect(Object.keys(saved).sort()).toEqual([
    `北辰基礎資料/pdf/${idA}.pdf`, `北辰基礎資料/pdf/${idB}.pdf`, '北辰基礎資料/北辰基礎資料.html', '北辰基礎資料/保存情報.json', '北辰基礎資料/使い方.txt',
  ].sort());
  expect(saved['北辰基礎資料/北辰基礎資料.html']).not.toContain('https://example.com');
  await page.evaluate(() => { (window as Window & { __schoolPickLibrary?: boolean }).__schoolPickLibrary = true; });
  await page.getByRole('button', { name: '北辰用フォルダを保存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '「北辰基礎資料.html」を開けば' })).toBeVisible();
  expect(pdfReads).toBe(2);
  await page.evaluate(key => { (window as unknown as Window & { __schoolFiles: Record<string, string> }).__schoolFiles[key] = 'corrupt'; }, `北辰基礎資料/pdf/${idA}.pdf`);
  await page.getByRole('button', { name: '北辰用フォルダを保存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '「北辰基礎資料.html」を開けば' })).toBeVisible();
  expect(pdfReads).toBe(3);
  const beforeFailure = await page.evaluate(() => (window as unknown as Window & { __schoolFiles: Record<string, string> }).__schoolFiles);
  await page.route('**/api/staff/interview-material-school-library', route => route.fulfill({ json: { items: schools } }));
  await page.route('https://example.com/school-c.pdf', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.getByRole('button', { name: '北辰用フォルダを保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '「叡明」を保存できませんでした。' })).toBeVisible();
  const afterFailure = await page.evaluate(() => (window as unknown as Window & { __schoolFiles: Record<string, string> }).__schoolFiles);
  expect(afterFailure).toEqual(beforeFailure);
  await page.screenshot({ path: 'analysis_outputs/hokushin-shared-folder-mobile.png', fullPage: true });
});
