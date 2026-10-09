import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const teacherId = '00000000-0000-4000-8000-000000000003';
const otherTeacher = '00000000-0000-4000-8000-000000000004';
const answerId = '11111111-1111-4111-8111-111111111111';
const students = [
  { number: '2018991', name: '確認用 生徒A', grade: '中3', teacher: '工藤', responses: [
    { id: answerId, date: '2026-09-20', schools: ['えいめい'], fields: [{ label: '所属校舎', value: '南教室' }] },
    { id: '22222222-2222-4222-8222-222222222222', date: '2026-09-01', schools: ['古い志望校'], fields: [] },
  ] },
  { number: '2022002', name: '確認用 生徒B', grade: '小5', teacher: '工藤', responses: [] },
  { number: '2019993', name: '確認用 生徒C', grade: '中2', teacher: '工藤', responses: [] },
];
const appointments = students.map((student, index) => ({ ...student, responses: undefined, id: `appointment-${index}`,
  teacherId, date: '2026-10-05', start: `${17 + index}:00`, source: 'notion-bensuke',
  editedAt: '2026-10-05T00:00:00.000Z', url: `https://notion.so/appointment-${index}` }));
const allAppointments = [...appointments, { ...appointments[0], id: 'other-teacher', teacher: '金城', teacherId: otherTeacher },
  { ...appointments[0], id: 'other-day', date: '2026-10-06' }];
const expectedFolder = (index: number) => `98面談資料/工藤先生/2026.10.05.${17 + index}00-${index === 0 ? '中３' : index === 1 ? '小５' : '中２'}${students[index].name.replace(/\s+/gu, '')}`;

type Payload = { kind: string; number: string; schools: string[]; campus: string; answerId?: string; selectedMaterialIds?: string[] };
async function setup(page: Page, info: TestInfo, mode = 'normal') {
  const root = resolve('analysis_outputs/batch-folder-verification', `${info.title.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const requests: Payload[] = [], jobs = new Map<string, Payload>();
  let picks = 0, reads = 0, fail = mode === 'failure' || mode === 'indexing', hold = mode === 'stop', aiCompleted = !['ai', 'failure'].includes(mode);
  let release: () => void = () => {};
  const gate = new Promise<void>(done => { release = done; });
  function local(directory: string, file = '') {
    const path = resolve(root, directory, file);
    if (!path.startsWith(root + sep)) throw Error('Path escaped');
    return path;
  }
  await page.exposeBinding('folderExists', async (_, directory: string) => (await stat(local(directory)).catch(() => null))?.isDirectory() ?? false);
  await page.exposeBinding('folderRead', async (_, directory: string, name: string) => Array.from(await readFile(local(directory, name))));
  await page.exposeBinding('folderWrite', async (_, directory: string, name: string, bytes: number[]) => {
    await mkdir(local(directory), { recursive: true }); await writeFile(local(directory, name), Buffer.from(bytes));
  });
  await page.exposeBinding('pickedFolder', () => { picks++; });
  await page.addInitScript(({ mode }) => {
    const win = window as unknown as {
      folderExists: (directory: string) => Promise<boolean>;
      folderRead: (directory: string, name: string) => Promise<number[]>;
      folderWrite: (directory: string, name: string, bytes: number[]) => Promise<void>;
      pickedFolder: () => Promise<void>;
    };
    const directory = (name: string): unknown => ({ name: name.split('/').at(-1),
      getDirectoryHandle: async (child: string, options: { create: boolean }) => {
        if (!options.create && !await win.folderExists(`${name}/${child}`)) throw new DOMException('Missing directory', 'NotFoundError');
        return directory(`${name}/${child}`);
      },
      getFileHandle: async (file: string) => ({ getFile: async () => new Blob([new Uint8Array(await win.folderRead(name, file))]),
        createWritable: async () => ({ write: async (value: string | Blob) => {
          const blob = typeof value === 'string' ? new Blob([value]) : value;
          await win.folderWrite(name, file, Array.from(new Uint8Array(await blob.arrayBuffer())));
        }, close: async () => {} }),
      }),
    });
    if (mode !== 'unsupported') Object.defineProperty(window, 'showDirectoryPicker', { value: async () => {
      await win.pickedFolder();
      if (mode === 'cancel') throw new DOMException('Canceled', 'AbortError');
      return directory(mode === 'wrong-root' ? 'Downloads' : '98面談資料');
    } });
    else Object.defineProperty(window, 'showDirectoryPicker', { value: undefined });
  }, { mode });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students } }));
  await page.route('**/api/staff/interview-material-appointments**', route => {
    reads++;
    const verify = new URL(route.request().url()).searchParams.get('verify');
    const rows = allAppointments.map(row => (mode === 'changed' && reads > 1 || mode === 'verify-changed' && verify === 'appointment-1')
      && row.id === 'appointment-1' ? { ...row, start: '21:00' } : row);
    return route.fulfill({ json: { source: 'notion-bensuke', appointments: rows,
      teachers: [{ id: teacherId, name: '工藤' }, { id: otherTeacher, name: '金城' }],
      review: [{ id: 'review', title: '担当不明の要確認予定', reason: '本人未特定', url: 'https://notion.so/review', teacherIds: [] }] } });
  });
  const summary = (number: string) => ({ status: aiCompleted ? 'completed' : 'queued', sourceHash: number,
    items: aiCompleted ? [{ source: '備考', note: 'AIで抽出した確認事項', original: '原文' }] : [] });
  await page.route('**/api/staff/interview-material-context**', route => {
    const number = new URL(route.request().url()).searchParams.get('number')!;
    return route.fulfill({ json: { studentNumber: number, capturedAt: new Date().toISOString(),
      records: [{ id: 'record', date: '2026-05-23', title: '進路相談', body: `記録本文 ${number}`, url: 'https://notion.so/record' }],
      info: [{ source: '備考', value: `生徒情報 ${number}` }], schoolMentions: [], summary: summary(number), studentUrl: 'https://notion.so/student', source: 'notion' } });
  });
  await page.route('**/api/staff/interview-material-info**', route => route.fulfill({ json: { summary: summary(new URL(route.request().url()).searchParams.get('number')!) } }));
  await page.route('https://fixture.invalid/*.pdf', route => route.fulfill({ body: '%PDF-1.4\n%%EOF', contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route('**/api/staff/interview-material-jobs**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Payload; requests.push(body);
      const id = `${body.kind}-${body.number}-${requests.length}`; jobs.set(id, body);
      return route.fulfill({ status: 201, json: { id } });
    }
    const id = new URL(route.request().url()).searchParams.get('id');
    if (!id) return route.fulfill({ json: { available: mode === 'offline' ? [] : [{ id: 'primary', priority: 1 }] } });
    const body = jobs.get(id)!;
    if (hold && body.kind === 'preview' && (mode === 'stop' && body.number === students[0].number
      || mode === 'failure' && !fail && body.number === students[1].number)) await gate;
    if (mode === 'failure' && fail && body.number === students[1].number && body.kind === 'generate')
      return route.fulfill({ json: { job: { status: 'failed', error: '確認用の作成失敗' } } });
    const materials = [{ id: 'guide' }, ...(body.answerId ? [{ id: 'survey' }] : [])];
    return route.fulfill({ json: { job: body.kind === 'preview'
      ? { status: 'completed', result: { schools: body.schools.map(name => ({ name, found: true })), materials,
        hokushin: mode === 'indexing' && fail && body.number === students[0].number ? { found: false, indexing: true, message: '確認用の北辰索引を作成中' } : { found: true } } }
      : { status: 'completed', pdfUrl: 'https://fixture.invalid/bundle.pdf', result: {
        items: materials.map(item => ({ label: item.id === 'guide' ? '指導簿' : '面談アンケート回答', source: item.id, previewUrl: `https://fixture.invalid/${item.id}.pdf` })),
        missing: body.number === students[2].number ? ['確認用の未取得資料'] : [], pages: 1,
      } } } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByLabel('面談日', { exact: true }).fill('2026-10-05');
  await page.getByRole('combobox', { name: '面談の先生', exact: true }).selectOption(teacherId);
  const panel = page.getByRole('region', { name: '日付と先生からまとめて保存' });
  await expect(panel.getByText('対象：3人', { exact: true })).toBeVisible();
  return { root, requests, panel, picks: () => picks, recover: () => { fail = false; },
    pauseRetry: () => { hold = true; }, release: () => { hold = false; release(); }, completeAI: () => { aiCompleted = true; } };
}

test('all students for selected day and teacher save once, preserve existing folder, use latest survey', async ({ page }, info) => {
  const fixture = await setup(page, info);
  const old = resolve(fixture.root, expectedFolder(0)); await mkdir(old, { recursive: true });
  await writeFile(resolve(old, '手作業資料.txt'), '既存資料');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 3/3人');
  expect(fixture.picks()).toBe(1);
  expect(fixture.requests.map(row => `${row.kind}:${row.number}`)).toEqual(students.flatMap(student => [`preview:${student.number}`, `generate:${student.number}`]));
  expect(fixture.requests[0]).toMatchObject({ schools: ['叡明'], campus: '南教室', answerId });
  expect(fixture.requests[1].selectedMaterialIds).toEqual(['guide', 'survey']);
  expect(fixture.requests[2]).not.toHaveProperty('answerId'); expect(fixture.requests[2].schools).toEqual([]);
  const container = resolve(old, '..'); const resaved = (await readdir(container)).find(name => name.includes('（再保存 '))!;
  expect(resaved).toBeTruthy(); expect(await readFile(resolve(old, '手作業資料.txt'), 'utf8')).toBe('既存資料');
  for (let index = 0; index < students.length; index++) {
    const folder = index ? resolve(fixture.root, expectedFolder(index)) : resolve(container, resaved);
    for (const file of ['material-0.pdf', 'staff-bundle.pdf', '面談資料.html', '面談記録.txt', '生徒情報・注意点.txt', 'AI要約.js', '保存情報.json', '資料一覧.txt'])
      expect((await readFile(resolve(folder, file))).length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(resolve(folder, '保存情報.json'), 'utf8')).appointment).toMatchObject({ id: `appointment-${index}`, teacherId, start: `${17 + index}:00` });
  }
  await expect(fixture.panel.getByText('未取得：確認用の未取得資料')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-batch-folders-mobile.png', fullPage: true });
});

test('one failure continues to remaining students and retry creates only the failed student', async ({ page }, info) => {
  const fixture = await setup(page, info, 'failure');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 2/3人・失敗 1人');
  const unchanged = await readFile(resolve(fixture.root, expectedFolder(0), '保存情報.json'), 'utf8');
  fixture.recover(); fixture.pauseRetry();
  await fixture.panel.getByRole('button', { name: '失敗・未実施分を再試行' }).click();
  await expect.poll(() => fixture.requests.length).toBe(7); fixture.completeAI();
  // AI updates for previously saved A/C must not replace B's live retry state.
  for (const index of [0, 2]) await expect.poll(async () => readFile(resolve(fixture.root, expectedFolder(index), 'AI要約.js'), 'utf8'), { timeout: 15000 }).toContain('AIで抽出した確認事項');
  await expect(fixture.panel.getByRole('listitem').nth(1)).toHaveAttribute('data-status', 'preview'); fixture.release();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 3/3人・失敗 0人');
  expect(fixture.requests.slice(6).map(row => row.number)).toEqual([students[1].number, students[1].number]);
  expect(fixture.picks()).toBe(1);
  expect(await readFile(resolve(fixture.root, expectedFolder(0), '保存情報.json'), 'utf8')).toBe(unchanged);
});

test('stop completes current student and retry saves only remaining students with same root', async ({ page }, info) => {
  const fixture = await setup(page, info, 'stop');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  await expect(page.getByLabel('面談日', { exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '面談の先生', exact: true })).toBeDisabled();
  await fixture.panel.getByRole('button', { name: 'この生徒の保存後に停止' }).click(); fixture.release();
  await expect(fixture.panel.getByRole('status')).toContainText('停止しました。 保存済み 1/3人・失敗 0人・未実施 2人');
  await fixture.panel.getByRole('button', { name: '失敗・未実施分を再試行' }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 3/3人');
  expect(fixture.requests.map(row => row.number)).toEqual(students.flatMap(student => [student.number, student.number]));
  expect(fixture.picks()).toBe(1);
});

test('changed schedule rejects the whole batch before generation or disk writes', async ({ page }, info) => {
  const fixture = await setup(page, info, 'changed');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('面談予定が変更されました');
  expect(fixture.requests).toEqual([]); expect(await readdir(fixture.root)).toEqual([]);
});

test('schedule changed during generation prevents that student save and continues safely', async ({ page }, info) => {
  const fixture = await setup(page, info, 'verify-changed');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 2/3人・失敗 1人');
  await expect(fixture.panel.getByText(/面談予定が変更されました/)).toBeVisible();
  expect(await stat(resolve(fixture.root, expectedFolder(1))).catch(() => null)).toBeNull();
  expect((await readFile(resolve(fixture.root, expectedFolder(2), '面談資料.html'))).length).toBeGreaterThan(0);
});

for (const mode of ['wrong-root', 'cancel', 'offline', 'unsupported']) {
  test(`${mode} cannot generate jobs or save files`, async ({ page }, info) => {
    const fixture = await setup(page, info, mode);
    const button = fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true });
    if (mode === 'offline' || mode === 'unsupported') await expect(button).toBeDisabled();
    else { await button.click(); await expect(fixture.panel.getByRole('status')).toContainText(mode === 'cancel' ? '選択を取り消しました' : '共有フォルダ「98面談資料」を選んで'); }
    expect(fixture.requests).toEqual([]); expect(await readdir(fixture.root)).toEqual([]);
  });
}

test('AI enrichment updates all saved folders after batch completes without regenerating PDFs', async ({ page }, info) => {
  const fixture = await setup(page, info, 'ai');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 3/3人'); fixture.completeAI();
  for (let index = 0; index < students.length; index++) await expect.poll(async () => readFile(resolve(fixture.root, expectedFolder(index), 'AI要約.js'), 'utf8'), { timeout: 15000 }).toContain('AIで抽出した確認事項');
  expect(fixture.requests).toHaveLength(6); expect(fixture.picks()).toBe(1);
  await expect(fixture.panel.getByText('AI要約を同じフォルダに追加しました。開いている面談資料.htmlにも反映されます。')).toHaveCount(3);
});

test('Hokushin indexing defers that student and retry includes their complete materials', async ({ page }, info) => {
  const fixture = await setup(page, info, 'indexing');
  await fixture.panel.getByRole('button', { name: '全員分のフォルダを作成', exact: true }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 2/3人・失敗 1人');
  await expect(fixture.panel.getByText('確認用の北辰索引を作成中', { exact: true })).toBeVisible();
  expect(fixture.requests.filter(row => row.number === students[0].number).map(row => row.kind)).toEqual(['preview']);
  fixture.recover(); await fixture.panel.getByRole('button', { name: '失敗・未実施分を再試行' }).click();
  await expect(fixture.panel.getByRole('status')).toContainText('保存済み 3/3人');
  expect(fixture.requests.slice(5).map(row => row.kind)).toEqual(['preview', 'generate']);
  expect(fixture.picks()).toBe(1);
});

test('batch design date and teacher change target path and retry works on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(resolve('docs/interview-batch-folder-design-20261005.html')).href);
  await page.getByLabel('面談の先生').selectOption('工藤'); await page.getByLabel('面談日').fill('2026-10-06');
  await expect(page.locator('#tree')).toContainText('工藤先生'); await expect(page.locator('#tree')).toContainText('2026.10.06');
  await page.getByRole('button', { name: '全員分のフォルダを作成' }).click(); await expect(page.getByRole('status')).toContainText('1人失敗');
  await page.getByRole('button', { name: '失敗分を再試行' }).click(); await expect(page.getByRole('status')).toContainText('2人全員');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-batch-design-mobile.png', fullPage: true });
});
