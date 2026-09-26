import { expect, test } from '@playwright/test';

const student = { number: '2018998', name: '確認用 生徒', grade: '中3', teacher: '工藤', responses: [{
  id: 'sample', date: '2026-09-12', schools: ['柏の葉', '国府台', 'えいめい'], fields: [
    { label: '第二志望校（任意回答）', value: '国府台' },
    { label: '現状の第一志望校（任意回答）', value: '柏の葉' },
    { label: '第三志望校（任意回答）', value: 'えいめい' },
  ], url: 'https://notion.so/example',
}] };

test('central worker previews sources then builds and saves a PDF without browser loopback access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const jobs: string[] = [];
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      jobs.push(body.kind);
      expect(body.schools).toEqual(['柏の葉', '国府台', '叡明']);
      return route.fulfill({ status: 201, json: { id: body.kind === 'preview' ? 'preview-id' : 'generate-id' } });
    }
    if (!url.searchParams.has('id')) return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
    if (url.searchParams.get('id') === 'preview-id') return route.fulfill({ json: { job: {
      status: 'completed', result: { schools: [
        { rank: 1, name: '柏の葉', found: true, files: [{ kind: '高校案内', year: '2027年度', filename: '柏の葉.jpg' }] },
        { rank: 2, name: '国府台', found: false, files: [] },
        { rank: 3, name: '叡明', found: true, files: [{ kind: '私立推薦基準', year: '2027年度', filename: '叡明.jpg' }] },
      ], hokushin: { found: true, year: '2026年度', round: '北辰中3第3回' },
        termReport: { found: true, year: '2026', term: '前期', filename: '通知.pdf', pages: [10] } },
    } } });
    return route.fulfill({ json: { job: { status: 'completed', pdfUrl: 'https://example.com/signed.pdf', result: {
      items: [{ label: '指導簿', source: 'guide', staffOnly: false }], missing: [], pages: 12,
      savedPath: 'C:\\Users\\test\\OneDrive\\面談準備\\保存済み資料\\sample.pdf', cloudSynced: true,
    } } } });
  });
  await page.route('http://127.0.0.1:38473/**', route => { throw Error(`unexpected loopback request: ${route.request().url()}`); });
  await page.goto('/staff/interview-materials');
  await expect(page.getByText('作成PCが稼働中です')).toBeVisible();
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption(student.number);
  await expect(page.getByRole('heading', { name: 'アンケート回答', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '第3志望' })).toHaveValue('叡明');
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect(page.locator('li').filter({ hasText: '第2志望：国府台' })).toContainText('該当資料なし');
  await expect(page.getByText('北辰の個人成績票：2026年度 北辰中3第3回 が見つかりました')).toBeVisible();
  await expect(page.getByText('成績通知の個人成績表：2026年度前期 通知.pdf の本人ページ（10）が見つかりました')).toBeVisible();
  expect(jobs).toEqual(['preview']);
  await page.getByRole('button', { name: 'PDFを作成' }).click();
  await expect(page.getByRole('heading', { name: '3. 資料を確認・印刷' })).toBeVisible();
  await expect(page.getByRole('link', { name: '先生用の一式PDFを表示・印刷' })).toHaveAttribute('href', 'https://example.com/signed.pdf');
  await expect(page.getByText('作成PCとOneDriveのクラウドに保存しました', { exact: false })).toBeVisible();
  expect(jobs).toEqual(['preview', 'generate']);
});

test('when both creation PCs are offline the page prevents new work and can refresh', async ({ page }) => {
  let online = false;
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: online ? [{ id: 'standby' }] : [] } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption(student.number);
  await expect(page.getByText('作成PCは停止中です。起動後に利用できます。')).toBeVisible();
  await expect(page.getByRole('button', { name: '資料を作る' })).toBeDisabled();
  online = true;
  await page.getByRole('button', { name: '稼働状況を再確認' }).click();
  await expect(page.getByRole('button', { name: '資料を作る' })).toBeEnabled();
});

test('a completed job can be reopened after reloading the page', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('id')) return route.fulfill({ json: { available: [], recent: [
      { id: 'saved-id', status: 'completed', number: student.number, name: student.name, createdAt: '2026-09-26' },
    ] } });
    return route.fulfill({ json: { job: { status: 'completed', pdfUrl: 'https://example.com/reopened.pdf', result: {
      items: [], missing: [], pages: 12, savedPath: 'C:\\OneDrive\\sample.pdf', cloudSynced: false,
    } } } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: 'PDFを再表示' }).click();
  await expect(page.getByRole('link', { name: '先生用の一式PDFを表示・印刷' })).toHaveAttribute('href', 'https://example.com/reopened.pdf');
});

test('a same-origin network failure gives a usable message', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [student] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.request().method() === 'POST'
    ? route.abort() : route.fulfill({ json: { available: [{ id: 'primary' }] } }));
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption(student.number);
  await page.getByRole('button', { name: '資料を作る' }).click();
  const alert = page.getByRole('alert').filter({ hasText: '勉たんとの通信が切れました' });
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText('Failed to fetch');
});
