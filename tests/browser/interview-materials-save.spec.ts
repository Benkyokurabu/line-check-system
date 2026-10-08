import { expect, test } from '@playwright/test';

const teacherId = '00000000-0000-4000-8000-000000000003';
let summaryRequests = 0;
test.beforeEach(async ({ page }) => {
  summaryRequests = 0;
  await page.route('**/api/staff/interview-material-school-library', route => route.fulfill({ json: { items: [
    { id: 'a'.repeat(64), school: '川口', reading: 'か川口', category: '公立', year: 2027, bytes: 100, previewUrl: 'https://example.com/material-school-a.pdf' },
    { id: 'b'.repeat(64), school: '叡明', reading: 'え叡明', category: '私立', year: 2026, bytes: 100, previewUrl: 'https://example.com/material-school-b.pdf' },
  ] } }));
  await page.route('https://example.com/material-school-*.pdf', route => route.fulfill({ body: '%PDF-1.4\n%%EOF', contentType: 'application/pdf' }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: {
    teachers: [{ id: teacherId, display_name: '工藤' },
      { id: '00000000-0000-4000-8000-000000000004', display_name: '金城' }],
  } }));
  await page.route('**/api/staff/interview-material-context**', route => route.fulfill({ json: {
    records: [{ id: 'record-1', date: '2026-05-23', title: '進路相談', body: '志望校を確認した。', url: 'https://notion.so/record' }],
    info: [{ source: '連絡先　備考', value: '面談連絡は保護者へ。' }],
    summary: { status: 'prepared', items: [] },
    studentUrl: 'https://notion.so/student', source: 'notion',
  } }));
  await page.route('**/api/staff/interview-material-info**', route => {
    if (route.request().method() === 'POST') { summaryRequests++; return route.fulfill({ json: { status: 'queued' } }); }
    return route.fulfill({ json: { summary: { status: 'completed', items: [
      { source: '連絡先　備考', note: '面談連絡は保護者へ。', original: '面談連絡は保護者へ。' },
    ] } } });
  });
});

const student = { number: '2018998', name: '確認用 生徒', grade: '中3', teacher: '工藤', responses: [{
  id: '11111111-1111-4111-8111-111111111111', date: '2026-09-12', schools: ['柏の葉', '国府台', 'えいめい'], fields: [
    { label: '第二志望校（任意回答）', value: '国府台' },
    { label: '現状の第一志望校（任意回答）', value: '柏の葉' },
    { label: '第三志望校（任意回答）', value: 'えいめい' },
  ], url: 'https://notion.so/example',
}] };
const materials = [
  { id: 'guide', group: '生徒本人の資料', label: '指導簿', detail: '生徒のページ', staffOnly: false },
  { id: 'survey', group: '生徒本人の資料', label: '面談アンケート回答', detail: '選択した回答', staffOnly: false },
  { id: 'school-3:aaaaaaaaaaaaaaaaaaaaaaaa', group: '志望校の資料', label: '柏の葉 ／ 高校案内', detail: '2027年度', staffOnly: false },
  { id: 'term-report', group: '生徒本人の資料', label: '成績通知の個人成績表', detail: '2026年度前期', staffOnly: false },
];

test('teacher chooses a name and uses the existing password to open materials', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submitted: { teacherId: string; password: string } | null = null;
  await page.route('**/api/staff/session', route => route.fulfill({ status: 401, json: { error: 'ログインし直してください。' } }));
  await page.route('**/api/staff/availability-login', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { staff: { role: 'teacher', displayName: '工藤' } } });
  });
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } }));
  await page.goto('/staff/interview-materials');
  await expect(page.getByRole('heading', { name: '先生ログイン' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '職員コード' })).toHaveCount(0);
  await page.screenshot({ path: 'analysis_outputs/interview-materials-teacher-login-form-mobile.png', fullPage: true });
  await page.getByRole('combobox', { name: '先生の名前' }).selectOption(teacherId);
  await page.getByLabel('いつものパスワード').fill('test-password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('heading', { name: '1. 生徒を選ぶ' })).toBeVisible();
  expect(submitted).toEqual({ teacherId, password: 'test-password' });
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-materials-teacher-login-mobile.png', fullPage: true });
});

test('an incorrect teacher password keeps the material page locked', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ status: 401, json: { error: 'ログインし直してください。' } }));
  await page.route('**/api/staff/availability-login', route => route.fulfill({ status: 401, json: {
    code: 'invalid_credentials', error: '職員コードまたはパスワードを確認してください。',
  } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '先生の名前' }).selectOption(teacherId);
  await page.getByLabel('いつものパスワード').fill('wrong-password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByText('先生の名前またはパスワードを確認してください。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '先生ログイン' })).toBeVisible();
  await expect(page.getByLabel('いつものパスワード')).toHaveValue('');
});

test('this PC targets the worker ID reported by the local helper', async ({ page }) => {
  const submitted: Record<string, unknown>[] = [];
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('http://127.0.0.1:38473/health', route => route.fulfill({
    json: { ready: true, workerId: 'standby' }, headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    if (route.request().method() === 'POST') {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id: 'preview-id' } });
    }
    if (new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: { job: {
      status: 'completed', result: { schools: [], materials: [{ id: 'guide', group: '本人', label: '学習簿', detail: '', staffOnly: false }] },
    } } });
    return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }, { id: 'standby', priority: 2 }] } });
  });
  await page.goto(`/staff/interview-materials?answer=${student.responses[0].id.replaceAll('-', '')}`);
  await page.getByRole('button', { name: 'このPCで処理' }).click();
  await expect(page.getByText('このPC（standby）で今回の資料を作成します。')).toBeVisible();
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].targetWorkerId).toBe('standby');
});

test('central worker previews sources then builds and saves a PDF without browser loopback access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pdfResponse = { body: '%PDF-1.4\n%%EOF', contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' } };
  await page.route('https://example.com/signed.pdf', route => route.fulfill(pdfResponse));
  await page.route('https://example.com/material-*.pdf', route => route.fulfill(pdfResponse));
  const jobs: string[] = [];
  let generatedIds: string[] = [];
  let appointmentReads = 0;
  await page.route('**/api/staff/interview-material-appointments**', route => {
    appointmentReads++;
    return route.fulfill({ status: 503, json: { error: '面談予定を取得できません。' } });
  });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      jobs.push(body.kind);
      expect(body.schools).toEqual(['柏の葉', '国府台', '叡明']);
      expect(body.answerId).toBe(student.responses[0].id);
      if (body.kind === 'generate') generatedIds = body.selectedMaterialIds;
      return route.fulfill({ status: 201, json: { id: body.kind === 'preview' ? 'preview-id' : 'generate-id' } });
    }
    if (!url.searchParams.has('id')) return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
    if (url.searchParams.get('id') === 'preview-id') return route.fulfill({ json: { job: {
      status: 'completed', result: { schools: [
        { rank: 1, name: '柏の葉', found: true, files: [{ kind: '高校案内', year: '2027年度', filename: '柏の葉.jpg' }] },
        { rank: 2, name: '国府台', found: false, files: [] },
        { rank: 3, name: '叡明', found: true, files: [{ kind: '私立推薦基準', year: '2027年度', filename: '叡明.jpg' }] },
      ], materials, hokushin: { found: true, year: '2026年度', round: '北辰中3第3回' },
        termReport: { found: true, year: '2026', term: '前期', filename: '通知.pdf', pages: [10] } },
    } } });
    return route.fulfill({ json: { job: { status: 'completed', pdfUrl: 'https://example.com/signed.pdf', result: {
      items: [
        { label: '指導簿', source: 'guide', staffOnly: false, startPage: 1, endPage: 2, previewUrl: 'https://example.com/material-0.pdf' },
        { label: '面談アンケート回答', source: 'survey', staffOnly: false, startPage: 3, endPage: 4, previewUrl: 'https://example.com/material-1.pdf' },
        { label: '成績通知', source: 'term-report', staffOnly: false, startPage: 5, endPage: 12, previewUrl: 'https://example.com/material-2.pdf' },
      ], missing: [], pages: 12,
      savedPath: 'C:\\Users\\test\\OneDrive\\面談準備\\保存済み資料\\sample.pdf', cloudSynced: true,
    } } } });
  });
  await page.route('http://127.0.0.1:38473/**', route => { throw Error(`unexpected loopback request: ${route.request().url()}`); });
  await page.addInitScript(() => {
    const saved: Record<string, string> = {};
    Object.defineProperty(window, '__savedFiles', { value: saved });
    const directory = (path: string): unknown => ({ name: path.split('/').at(-1),
      getDirectoryHandle: async (folderName: string, options: { create: boolean }) => {
        const child = `${path}/${folderName}`;
        if (!options.create && !Object.keys(saved).some(key => key.startsWith(`${child}/`))) throw new DOMException('Missing directory', 'NotFoundError');
        return directory(child);
      },
      getFileHandle: async (fileName: string, options: { create: boolean }) => {
        const key = `${path}/${fileName}`;
        if (!options.create && !(key in saved)) throw Error('NotFound');
        return { getFile: async () => new Blob([saved[key] ?? '']), createWritable: async () => ({
          write: async (data: Blob | string) => { saved[key] = typeof data === 'string' ? data : await data.text(); },
          close: async () => {},
        }) };
      },
    });
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => directory('98面談資料') });
  });
  await page.goto(`/staff/interview-materials?answer=${student.responses[0].id.replaceAll('-', '')}`);
  await expect(page.getByText('主担当PCが稼働中です')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'アンケート回答', exact: true })).toBeVisible();
  await expect.poll(() => summaryRequests).toBe(1);
  await expect(page.getByRole('textbox', { name: '第3志望' })).toHaveValue('叡明');
  await page.getByRole('button', { name: '資料を作る' }).click();
  const contextPreview = page.getByRole('region', { name: '面談記録とAIのまとめ' });
  await expect(contextPreview.getByText('面談前の確認点（AI）')).toBeVisible();
  await expect(contextPreview.getByText('面談連絡は保護者へ。')).toBeVisible();
  await contextPreview.getByText('2026-05-23　進路相談').click();
  await expect(contextPreview.getByText('志望校を確認した。')).toBeVisible();
  expect(summaryRequests).toBe(1);
  await expect(page.locator('li').filter({ hasText: '第2志望：国府台' })).toContainText('該当資料なし');
  await expect(page.getByRole('checkbox', { name: /面談アンケート回答/ })).toBeChecked();
  await expect(page.getByText('選択中 4点 ／ 見つかった資料 4点')).toBeVisible();
  await page.getByRole('checkbox', { name: /柏の葉 ／ 高校案内/ }).uncheck();
  await expect(page.getByText('選択中 3点 ／ 見つかった資料 4点')).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-materials-print-selection-live-mobile.png', fullPage: true });
  expect(jobs).toEqual(['preview']);
  await page.getByRole('button', { name: '選んだ3点でPDFを作成' }).click();
  await expect(page.getByRole('heading', { name: '3. 完成した資料を使う' })).toBeVisible({ timeout: 15000 });
  const print = page.getByRole('link', { name: '印刷用の一式PDFを開く' });
  const screen = page.getByRole('button', { name: /画面で見る/ });
  const downloadButton = page.getByRole('button', { name: /共有フォルダに保存/ });
  await expect(downloadButton).toBeVisible();
  await expect(downloadButton).toBeEnabled();
  await expect(page.getByRole('button', { name: /PCに保存/ })).toHaveCount(0);
  await expect(page.getByLabel('HTMLとPDFの保存先')).toContainText('保存後は「面談資料.html」を開く');
  await expect(page.getByLabel('HTMLとPDFの保存先')).toContainText('\\\\TS3210\\benko\\03 教務部\\015 各面談行事／文化会館も含む\\98面談資料');
  await downloadButton.click();
  await expect(page.getByRole('status').filter({ hasText: '「個別保存／中3 確認用 生徒（2018998）」を保存しました' })).toBeVisible();
  await expect(page.getByRole('region', { name: '保存先の面談予定を選ぶ' })).toHaveCount(0);
  expect(appointmentReads).toBe(0);
  await expect(downloadButton).toBeEnabled();
  await expect(page.getByRole('heading', { name: '3. 完成した資料を使う' })).toBeVisible();
  expect(jobs).toEqual(['preview', 'generate']);
  await expect(page.getByLabel('HTMLとPDFの保存先')).toContainText('個別保存／中3 確認用 生徒（2018998）／面談資料.html');
  await expect(print).toHaveAttribute('href', 'https://example.com/signed.pdf#zoom=100&navpanes=0');
  await expect(page.getByRole('dialog', { name: '面談資料のプレビュー' })).toBeHidden();
  const positions = await Promise.all([print, screen, downloadButton].map(element => element.boundingBox()));
  expect(positions.every(Boolean)).toBeTruthy();
  expect(Math.abs(positions[0]!.y - positions[1]!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions[1]!.y - positions[2]!.y)).toBeLessThanOrEqual(1);
  expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
  expect(positions[1]!.x).toBeLessThan(positions[2]!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-shared-folder-result-mobile.png', fullPage: true });
  await screen.click();
  await expect(page.getByTitle('指導簿のPDFプレビュー')).toHaveAttribute('src', 'https://example.com/material-0.pdf#zoom=100&navpanes=0');
  await expect(page.getByRole('link', { name: 'このPDFを別画面で開く' })).toHaveAttribute('href', 'https://example.com/material-0.pdf#zoom=100&navpanes=0');
  await expect(page.getByTitle('指導簿のPDFプレビュー')).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('button', { name: '指導簿を表示' })).toHaveText('指導簿');
  await expect(page.getByRole('button', { name: '面談アンケート回答を表示' })).toHaveText('アンケート');
  await expect(page.getByRole('button', { name: '成績通知を表示' })).toHaveText('塾内成績');
  await expect(page.getByRole('button', { name: '面談記録を表示' })).toHaveText('面談記録');
  await expect(page.getByRole('button', { name: '情報を表示' })).toHaveText('情報');
  let firstLibraryRead = true;
  await page.route('**/api/staff/interview-material-school-library', route => {
    if (!firstLibraryRead) return route.fallback();
    firstLibraryRead = false;
    return route.fulfill({ status: 503, json: { error: '学校一覧の読み込みに失敗しました。' } });
  });
  await page.getByRole('button', { name: '北辰基礎資料の目次', exact: true }).click();
  await expect(page.getByRole('heading', { name: '北辰基礎資料の目次' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '学校一覧の読み込みに失敗しました。' })).toBeVisible();
  await page.getByRole('button', { name: '学校一覧を再読み込み' }).click();
  await expect(page.getByText('2件 / 全2件')).toBeVisible();
  await page.getByRole('searchbox', { name: '学校名で検索' }).fill('川口');
  await expect(page.getByText('1件 / 全2件')).toBeVisible();
  await page.getByRole('button', { name: '川口の北辰基礎資料を表示' }).click();
  await expect(page.getByTitle('川口の北辰基礎資料')).toHaveAttribute('src', 'https://example.com/material-school-a.pdf#zoom=100&navpanes=0');
  await page.getByRole('button', { name: '北辰基礎資料の目次', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '学校名で検索' })).toHaveValue('川口');
  await page.getByRole('searchbox', { name: '学校名で検索' }).fill('');
  await page.getByRole('combobox', { name: '学校の種類' }).selectOption('私立');
  await expect(page.getByRole('button', { name: '叡明の北辰基礎資料を表示' })).toContainText('2026年度');
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/hokushin-school-library-online-mobile.png', fullPage: true });
  expect(summaryRequests).toBe(1);
  await page.getByRole('button', { name: '面談記録を表示' }).click();
  await expect(page.getByRole('article').filter({ hasText: '進路相談' })).toContainText('志望校を確認した。');
  await expect(page.getByText('面談前に確認したい点（AI）')).toBeVisible();
  expect(summaryRequests).toBe(1);
  await page.getByRole('button', { name: '情報を表示' }).click();
  await expect(page.getByText('AIが選んだ特記事項')).toBeVisible();
  expect(summaryRequests).toBe(1);
  await expect(page.getByRole('dialog').getByText('面談連絡は保護者へ。').first()).toBeVisible();
  await page.getByRole('button', { name: '面談アンケート回答を表示' }).click();
  await expect(page.getByTitle('面談アンケート回答のPDFプレビュー')).toHaveAttribute('src', 'https://example.com/material-1.pdf#zoom=100&navpanes=0');
  await expect(page.getByTitle('指導簿のPDFプレビュー')).toHaveAttribute('data-active', 'false');
  const viewerBack = page.getByRole('button', { name: '← 完成した資料に戻る' });
  await expect(viewerBack).toBeVisible();
  const backBounds = await viewerBack.boundingBox();
  expect(backBounds).not.toBeNull();
  expect(backBounds!.x).toBeGreaterThanOrEqual(0);
  expect(backBounds!.x + backBounds!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await viewerBack.click();
  await expect(screen).toBeFocused();
  await screen.click();
  await expect(viewerBack).toBeVisible();
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: '成績通知を表示' }).hover();
  await expect(page.getByTitle('成績通知のPDFプレビュー')).toHaveAttribute('src', 'https://example.com/material-2.pdf#zoom=100&navpanes=0');
  await expect(page.getByTitle('成績通知のPDFプレビュー')).toHaveAttribute('data-active', 'true');
  await page.getByRole('button', { name: '指導簿を表示' }).hover();
  await expect(page.getByTitle('指導簿のPDFプレビュー')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTitle('指導簿のPDFプレビュー')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '面談資料のプレビュー' })).toHaveCSS('position', 'fixed');
  await expect(page.getByText('作成PCとOneDriveのクラウドに保存しました', { exact: false })).toBeVisible();
  await viewerBack.click();
  await expect(screen).toBeFocused();
  await page.getByRole('button', { name: '← アンケート・資料の選択に戻る' }).click();
  await expect(page.getByRole('heading', { name: '2. アンケート回答を選ぶ' })).toBeFocused();
  await expect(page.getByRole('button', { name: '選んだ3点でPDFを作成' })).toBeVisible();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /一式PDFをダウンロード/ }).click();
  expect((await pdfDownload).suggestedFilename()).toBe('面談資料_2018998_generate.pdf');
  await expect(page.getByRole('status').filter({ hasText: '面談資料_2018998_generate.pdf' })).toBeVisible();
  const saved = await page.evaluate(() => (window as Window & { __savedFiles?: Record<string, string> }).__savedFiles ?? {});
  const folderName = '98面談資料/個別保存/中3 確認用 生徒（2018998）';
  expect(Object.keys(saved).sort()).toEqual([
    `${folderName}/material-0.pdf`, `${folderName}/material-1.pdf`,
    `${folderName}/material-2.pdf`, `${folderName}/staff-bundle.pdf`,
    `${folderName}/面談記録.txt`, `${folderName}/生徒情報・注意点.txt`, `${folderName}/資料一覧.txt`,
    `${folderName}/面談資料.html`, `${folderName}/保存情報.json`, `${folderName}/AI要約.js`,
  ].sort());
  expect(saved[`${folderName}/面談資料.html`]).toContain('file:`material-${tab}.pdf`');
  expect(saved[`${folderName}/面談資料.html`]).not.toContain('"schoolLibrary":');
  expect(Object.keys(saved).some(name => name.includes('/hokushin-'))).toBe(false);
  expect(saved[`${folderName}/面談資料.html`]).toContain('staff-bundle.pdf#zoom=100&navpanes=0');
  expect(saved[`${folderName}/面談資料.html`]).toContain('面談アンケート回答');
  expect(saved[`${folderName}/面談資料.html`]).toContain('"kind":"塾内成績"');
  expect(saved[`${folderName}/面談資料.html`]).toContain('志望校を確認した。');
  expect(saved[`${folderName}/面談資料.html`]).toContain('面談連絡は保護者へ。');
  expect(saved[`${folderName}/面談記録.txt`]).toContain('志望校を確認した。');
  expect(saved[`${folderName}/生徒情報・注意点.txt`]).toContain('面談連絡は保護者へ。');
  expect(jobs).toEqual(['preview', 'generate']);
  expect(generatedIds).toEqual(['guide', 'survey', 'term-report']);
  let studentLibraryReads = 0;
  await page.route('**/api/staff/interview-material-school-library', route => {
    studentLibraryReads++;
    return route.fulfill({ status: 503, json: { error: '学校一覧を取得できませんでした。' } });
  });
  await downloadButton.click();
  await expect(page.getByRole('status').filter({ hasText: '面談資料.html' })).toBeVisible();
  expect(studentLibraryReads).toBe(0);
  const after = await page.evaluate(() => (window as Window & { __savedFiles?: Record<string, string> }).__savedFiles ?? {});
  for (const [name, contents] of Object.entries(saved)) expect(after[name]).toBe(contents);
  expect(Object.keys(after).some(name => name.includes('（再保存 '))).toBe(true);
  expect(appointmentReads).toBe(0);
  await page.route('https://example.com/signed.pdf', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await downloadButton.click();
  await expect(page.getByRole('status').filter({ hasText: '「印刷用の一式PDF」を取得できませんでした' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __savedFiles?: Record<string, string> }).__savedFiles ?? {})).toEqual(after);
  await expect(downloadButton).toBeEnabled();
});

test('the school library requires a staff login', async ({ request }) => {
  const response = await request.get('/api/staff/interview-material-school-library');
  expect(response.status()).toBe(401);
  expect(await response.json()).not.toHaveProperty('items');
});

test('when both creation PCs are offline the page prevents new work and can refresh', async ({ page }) => {
  let online = false;
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: online ? [{ id: 'standby', priority: 2 }] : [] } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: /中3 確認用 生徒/ }).click();
  await expect(page.getByText('作成PCは停止中です。起動後に利用できます。')).toBeVisible();
  await expect(page.getByRole('button', { name: '資料を作る' })).toBeDisabled();
  online = true;
  await page.getByRole('button', { name: '稼働状況を再確認' }).click();
  await expect(page.getByText('予備PCが稼働中です。主担当PCの代わりに作成できます。')).toBeVisible();
  await expect(page.getByRole('button', { name: '資料を作る' })).toBeEnabled();
});

test('recent creation requests are hidden from the materials page', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [], recent: [
      { id: 'saved-id', status: 'completed', number: student.number, name: student.name, createdAt: '2026-09-26' },
    ] } }));
  await page.goto('/staff/interview-materials');
  await expect(page.getByRole('heading', { name: '1. 生徒を選ぶ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近の作成依頼' })).toHaveCount(0);
});

test('a same-origin network failure gives a usable message', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.request().method() === 'POST'
    ? route.abort() : route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: /中3 確認用 生徒/ }).click();
  await page.getByRole('button', { name: '資料を作る' }).click();
  const alert = page.getByRole('alert').filter({ hasText: '勉たんとの通信が切れました' });
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText('Failed to fetch');
});

test('filters by teacher, grade and contained name, and selects a linked survey answer', async ({ page }) => {
  const linked = { ...student, name: '木村 美海', responses: [{ ...student.responses[0], id: '11111111-1111-4111-8111-111111111111' }] };
  const others = [
    { ...student, number: '2018997', name: '木村 花子', teacher: '佐藤' },
    { ...student, number: '2018996', name: '佐藤 美海', grade: '中2' },
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [linked, ...others] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '担任' }).selectOption('工藤');
  await page.getByRole('combobox', { name: '学年' }).selectOption('中3');
  await page.getByRole('searchbox', { name: '氏名・学籍番号に含まれる文字' }).fill('木村美海');
  await expect(page.getByText('該当 1人')).toBeVisible();
  await page.getByRole('button', { name: /中3 木村 美海/ }).click();
  await expect(page.getByText('選択中：中3 木村 美海', { exact: false })).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-materials-selection-mobile.png', fullPage: true });
  await page.goto('/staff/interview-materials?answer=11111111111141118111111111111111');
  await expect(page.getByText('選択中：中3 木村 美海', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'アンケート回答', exact: true })).toBeVisible();
});

test('a student with multiple answers sends only the chosen answer to PDF generation', async ({ page }) => {
  const older = { ...student.responses[0], id: '22222222-2222-4222-8222-222222222222', date: '2026-09-10' };
  const multiple = { ...student, responses: [student.responses[0], older] };
  const submitted: Array<{ kind: string; answerId?: string; selectedMaterialIds?: string[] }> = [];
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [multiple] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      submitted.push({ kind: body.kind, answerId: body.answerId, selectedMaterialIds: body.selectedMaterialIds });
      return route.fulfill({ status: 201, json: { id: body.kind } });
    }
    if (!url.searchParams.has('id')) return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
    return route.fulfill({ json: { job: { status: 'completed', result: url.searchParams.get('id') === 'preview'
      ? { schools: [], materials: [materials[0], materials[1]], hokushin: { found: false }, termReport: { found: false } }
      : { items: [{ label: '面談アンケート回答：2026-09-10', source: 'survey', staffOnly: false }], missing: [], pages: 1 } } } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: /中3 確認用 生徒/ }).click();
  await expect(page.getByRole('button', { name: '資料を作る' })).toBeDisabled();
  await page.getByRole('radio', { name: /2件目/ }).check();
  await page.getByRole('button', { name: '資料を作る' }).click();
  await page.getByRole('button', { name: '選んだ2点でPDFを作成' }).click();
  await expect(page.getByText('面談アンケート回答：2026-09-10')).toBeVisible();
  expect(submitted).toEqual([{ kind: 'preview', answerId: older.id, selectedMaterialIds: undefined },
    { kind: 'generate', answerId: older.id, selectedMaterialIds: ['guide', 'survey'] }]);
});

test('all deselected materials prevent PDF creation and can be restored', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { id: 'preview-id' } });
    if (!new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
    return route.fulfill({ json: { job: { status: 'completed', result: { schools: [], materials,
      hokushin: { found: false }, termReport: { found: false } } } } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: /中3 確認用 生徒/ }).click();
  await page.getByRole('button', { name: '資料を作る' }).click();
  await page.getByRole('button', { name: '選択をすべて外す' }).click();
  await expect(page.getByRole('button', { name: '選んだ0点でPDFを作成' })).toBeDisabled();
  await page.getByRole('button', { name: '見つかった資料をすべて選ぶ' }).click();
  await expect(page.getByRole('button', { name: '選んだ4点でPDFを作成' })).toBeEnabled();
});
