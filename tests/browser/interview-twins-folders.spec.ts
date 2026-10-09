import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const mode of ['normal', 'retry'] as const) test(`shared twin interview saves each student's own folder: ${mode}`, async ({ page }) => {
  const root = resolve('analysis_outputs/twin-folders', `${mode}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const students = [
    { number: '2018254', name: '川 島 清 雅', grade: '中3', teacher: '工藤', responses: [
      { id: '11111111-1111-4111-8111-111111111111', date: '2026-09-20', schools: ['叡明'], fields: [] }] },
    { number: '2018255', name: '川 島 颯 真', grade: '中3', teacher: '工藤', responses: [
      { id: '22222222-2222-4222-8222-222222222222', date: '2026-09-21', schools: ['越谷南'], fields: [] }] },
  ];
  const appointments = students.map(student => ({ ...student, id: 'one-notion-page', teacherId: 'teacher-1',
    date: '2026-10-07', start: '20:30', editedAt: '2026-10-05T00:00:00Z', url: 'https://notion.so/fixture', source: 'notion-bensuke' }));
  const requests: { kind: string; number: string; schools: string[]; answerId: string }[] = [];
  let failing = mode === 'retry', picks = 0;
  const local = (directory: string, file = '') => {
    const path = resolve(root, directory, file);
    if (!path.startsWith(root + sep)) throw Error('Path escaped');
    return path;
  };
  await page.exposeBinding('folderExists', async (_, directory: string) => (await stat(local(directory)).catch(() => null))?.isDirectory() ?? false);
  await page.exposeBinding('folderRead', async (_, directory: string, name: string) => Array.from(await readFile(local(directory, name))));
  await page.exposeBinding('folderWrite', async (_, directory: string, name: string, bytes: number[]) => {
    await mkdir(local(directory), { recursive: true }); await writeFile(local(directory, name), Buffer.from(bytes));
  });
  await page.exposeBinding('pickedFolder', () => { picks++; });
  await page.addInitScript(() => {
    const win = window as unknown as {
      folderExists: (path: string) => Promise<boolean>; folderRead: (path: string, file: string) => Promise<number[]>;
      folderWrite: (path: string, file: string, bytes: number[]) => Promise<void>; pickedFolder: () => Promise<void>;
    };
    const dir = (name: string): unknown => ({ name: name.split('/').at(-1),
      getDirectoryHandle: async (child: string, options: { create: boolean }) => {
        if (!options.create && !await win.folderExists(`${name}/${child}`)) throw new DOMException('Missing', 'NotFoundError');
        return dir(`${name}/${child}`);
      }, getFileHandle: async (file: string) => ({ getFile: async () => new Blob([new Uint8Array(await win.folderRead(name, file))]),
        createWritable: async () => ({ write: async (value: string | Blob) => {
          const blob = typeof value === 'string' ? new Blob([value]) : value;
          await win.folderWrite(name, file, Array.from(new Uint8Array(await blob.arrayBuffer())));
        }, close: async () => {} }) }) });
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => { await win.pickedFolder(); return dir('98面談資料'); } });
  });
  await page.route('**/api/staff/session', r => r.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', r => r.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', r => r.fulfill({ json: { students } }));
  await page.route('**/api/staff/interview-material-appointments**', r => r.fulfill({ json: {
    source: 'notion-bensuke', appointments, review: [], teachers: [{ id: 'teacher-1', name: '工藤' }] } }));
  await page.route('**/api/staff/interview-material-context**', r => {
    const number = new URL(r.request().url()).searchParams.get('number');
    return r.fulfill({ json: { studentNumber: number, capturedAt: new Date().toISOString(),
      records: [{ id: number, date: '2026-05-23', title: '進路相談', body: `本人の面談記録 ${number}`, url: 'https://notion.so/record' }],
      info: [{ source: '備考', value: `本人の生徒情報 ${number}` }], summary: { status: 'empty', items: [] }, source: 'notion' } });
  });
  const jobs = new Map<string, { kind: string; number: string; schools: string[]; answerId: string }>();
  await page.route('https://fixture.invalid/*.pdf', r => r.fulfill({ body: '%PDF-1.4\n%%EOF', contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route('**/api/staff/interview-material-jobs**', r => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON(); requests.push(body);
      const id = `${requests.length}`; jobs.set(id, body); return r.fulfill({ status: 201, json: { id } });
    }
    const id = new URL(r.request().url()).searchParams.get('id');
    if (!id) return r.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
    const body = jobs.get(id)!;
    if (failing && body.kind === 'generate' && body.number === '2018255')
      return r.fulfill({ json: { job: { status: 'failed', error: '二人目だけの作成失敗' } } });
    return r.fulfill({ json: { job: body.kind === 'preview'
      ? { status: 'completed', result: { schools: body.schools.map(name => ({ name })), materials: [{ id: `personal-${body.number}` }] } }
      : { status: 'completed', pdfUrl: `https://fixture.invalid/${body.number}.pdf`, result: { items: [
        { label: `本人資料 ${body.number}`, source: `personal-${body.number}`, previewUrl: `https://fixture.invalid/${body.number}.pdf` }], missing: [] } } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/interview-materials'); await page.getByLabel('面談日', { exact: true }).fill('2026-10-07');
  const choices = page.getByLabel('選んだ日の面談予定').getByRole('button');
  await expect(choices).toHaveCount(2);
  await choices.nth(0).click(); await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await choices.nth(1).click(); await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: '面談の先生', exact: true }).selectOption('teacher-1');
  const panel = page.getByRole('region', { name: '日付と先生からまとめて保存' });
  await expect(panel.getByText('対象：2人', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  const results = panel.getByRole('listitem');
  if (mode === 'retry') {
    await expect(panel.getByRole('status')).toContainText('保存済み 1/2人・失敗 1人');
    await expect(results.nth(0)).toHaveAttribute('data-status', 'saved');
    await expect(results.nth(1)).toHaveAttribute('data-status', 'failed');
    failing = false; await panel.getByRole('button', { name: '失敗・未実施分を再試行' }).click();
  }
  await expect(panel.getByRole('status')).toContainText('保存済み 2/2人・失敗 0人');
  await expect(results).toHaveCount(2); expect(picks).toBe(1);
  expect(requests.slice(0, 4).map(r => r.number)).toEqual(['2018254', '2018254', '2018255', '2018255']);
  expect(requests[0]).toMatchObject({ answerId: students[0].responses[0].id, schools: ['叡明'] });
  expect(requests[2]).toMatchObject({ answerId: students[1].responses[0].id, schools: ['越谷南'] });
  if (mode === 'retry') expect(requests.slice(4).map(r => r.number)).toEqual(['2018255', '2018255']);
  for (const student of students) {
    const folder = resolve(root, `98面談資料/工藤先生/2026.10.07.2030-中３${student.name.replace(/\s+/gu, '')}`);
    expect(await readFile(resolve(folder, '面談記録.txt'), 'utf8')).toContain(student.number);
    const html = await readFile(resolve(folder, '面談資料.html'), 'utf8'); expect(html).toContain(student.name);
    expect(JSON.parse(await readFile(resolve(folder, '保存情報.json'), 'utf8')).appointment).toMatchObject({ id: 'one-notion-page', number: student.number, start: '20:30' });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(root, 'twins-mobile.png'), fullPage: true });
});

test('twin design shows two separate folders on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(resolve('docs/interview-twins-design-20261005.html')).href);
  await page.getByRole('button', { name: '二人分の保存を確認' }).click();
  await expect(page.getByRole('status')).toContainText('保存済み 2/2人');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
