import { expect, test } from '@playwright/test';

test('a generated bundle is saved to OneDrive on request and shows the saved location', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let saveCalls = 0;
  let generateCalls = 0;
  let previewCalls = 0;
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [
    { number: '2018999', name: '確認用生徒', grade: '中3', teacher: '工藤', responses: [{ id: 'answer', date: '2026-09-25', schools: ['大宮'], fields: [], url: 'https://notion.so/example' }] },
  ] } }));
  await page.route('http://127.0.0.1:38473/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:3197', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/health') return route.fulfill({ json: { ready: true }, headers });
    if (path === '/preview') {
      previewCalls += 1;
      return route.fulfill({ json: { schools: [{ rank: 1, surveyName: '大宮', name: '大宮', found: true, files: [{ kind: '高校入試選抜基準', year: '2027年度', filename: '大宮.pdf' }] }], termReport: { found: true, year: '2026', term: '前期', filename: '確認用生徒.pdf', pages: [2] } }, headers });
    }
    if (path === '/generate') {
      generateCalls += 1;
      return route.fulfill({ json: { items: [{ label: '指導簿', source: 'guide', staffOnly: false }], missing: [], pages: 1, combinedUrl: '/pdf/token/staff-bundle.pdf', guideUrl: null, ...(generateCalls === 1 ? { saveUrl: '/save/token' } : {}) }, headers });
    }
    if (path === '/save/token') {
      saveCalls += 1;
      return route.fulfill({ json: { folder: 'C:\\Users\\test\\OneDrive\\面談準備\\保存済み資料', filename: '20260926_2018999_面談資料.pdf', cloudSynced: true }, headers });
    }
    return route.abort();
  });

  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption('2018999');
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect(page.getByText('高校入試選抜基準 2027年度')).toBeVisible();
  await expect(page.getByText('成績通知の個人成績表：2026年度前期 確認用生徒.pdf の本人ページ（2）が見つかりました')).toBeVisible();
  expect(previewCalls).toBe(1);
  await page.getByRole('button', { name: 'PDFを作成' }).click();
  await page.getByRole('button', { name: 'OneDriveに保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('このPCとOneDriveのクラウドに保存しました');
  await expect(page.getByRole('button', { name: 'OneDriveに保存済み' })).toBeDisabled();
  expect(saveCalls).toBe(1);
  await page.getByRole('button', { name: 'PDFを作成' }).click();
  await expect(page.getByRole('button', { name: 'OneDriveに保存', exact: true })).toBeDisabled();
  await expect(page.getByText('このPCの面談資料アプリを更新するとOneDriveへ直接保存できます。')).toBeVisible();
});

test('survey and ranked schools stay visible while checking years before PDF creation', async ({ page }) => {
  let previewSchools: string[] = [];
  let generated = 0;
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [{
    number: '2018998', name: '確認用 生徒', grade: '中3', teacher: '工藤', responses: [{ id: 'sample', date: '2026-09-12',
      schools: ['柏の葉', '国府台', 'えいめい'], fields: [
        { label: '第二志望校（任意回答）', value: '国府台' }, { label: '現状の第一志望校（任意回答）', value: '柏の葉' },
        { label: '第三志望校（任意回答）', value: 'えいめい' },
      ], url: 'https://notion.so/example' }],
  }] } }));
  await page.route('http://127.0.0.1:38473/**', route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:3197', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/health') return route.fulfill({ json: { ready: true }, headers });
    if (path === '/preview') {
      previewSchools = JSON.parse(route.request().postData() || '{}').schools;
      return route.fulfill({ json: { schools: [
        { rank: 1, surveyName: '柏の葉', name: '柏の葉', found: true, files: [{ kind: '高校案内', year: '2027年度', filename: '柏の葉.jpg' }] },
        { rank: 2, surveyName: '国府台', name: '国府台', found: false, files: [] },
        { rank: 3, surveyName: '叡明', name: '叡明', found: true, files: [{ kind: '私立推薦基準', year: '2027年度', filename: '叡明.jpg' }] },
      ], hokushin: { found: true, year: '2026年度', round: '北辰中3第3回', filename: 'sample.pdf' },
        termReport: { found: true, year: '2026', term: '前期', filename: '通知.pdf', pages: [10] } }, headers });
    }
    if (path === '/generate') {
      generated += 1;
      return route.fulfill({ json: { items: [], missing: [], pages: 1, combinedUrl: '/pdf/token/staff-bundle.pdf', guideUrl: null, saveUrl: '/save/token' }, headers });
    }
    return route.abort();
  });
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption('2018998');
  await expect(page.getByRole('heading', { name: 'アンケート回答', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '第1志望' })).toHaveValue('柏の葉');
  await expect(page.getByRole('textbox', { name: '第2志望' })).toHaveValue('国府台');
  await expect(page.getByRole('textbox', { name: '第3志望' })).toHaveValue('叡明');
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect(page.locator('li').filter({ hasText: '第2志望：国府台' })).toContainText('該当資料なし');
  expect(previewSchools).toEqual(['柏の葉', '国府台', '叡明']);
  expect(generated).toBe(0);
  await expect(page.locator('li').filter({ hasText: '第3志望：叡明' })).toContainText('2027年度');
  await expect(page.getByText('北辰の個人成績票：2026年度 北辰中3第3回 が見つかりました')).toBeVisible();
  await expect(page.getByText('成績通知の個人成績表：2026年度前期 通知.pdf の本人ページ（10）が見つかりました')).toBeVisible();
  await page.getByRole('button', { name: 'PDFを作成' }).click();
  await expect(page.getByRole('heading', { name: '3. 資料を確認・印刷' })).toBeVisible();
  expect(generated).toBe(1);
});

test('a blocked browser connection explains how to allow local app access', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [
    { number: '2018998', name: '確認用生徒', grade: '中3', teacher: '工藤', responses: [] },
  ] } }));
  await page.route('http://127.0.0.1:38473/health', route => route.abort());
  await page.goto('/staff/interview-materials');
  await page.getByRole('combobox', { name: '生徒', exact: true }).selectOption('2018998');
  await page.getByRole('button', { name: '資料を作る' }).click();
  const connectionAlert = page.getByRole('alert').filter({ hasText: 'このPCの資料アプリへの接続' });
  await expect(connectionAlert).toContainText('ローカル ネットワークへのアクセス');
  await expect(connectionAlert).not.toContainText('Failed to fetch');
});
