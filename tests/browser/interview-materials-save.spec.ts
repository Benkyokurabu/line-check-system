import { expect, test } from '@playwright/test';

test('a generated bundle is saved to OneDrive on request and shows the saved location', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let saveCalls = 0;
  let generateCalls = 0;
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
  await page.getByRole('button', { name: 'この生徒の資料を作る' }).click();
  await page.getByRole('button', { name: 'OneDriveに保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('このPCとOneDriveのクラウドに保存しました');
  await expect(page.getByRole('button', { name: 'OneDriveに保存済み' })).toBeDisabled();
  expect(saveCalls).toBe(1);
  await page.getByRole('button', { name: 'この生徒の資料を作る' }).click();
  await expect(page.getByRole('button', { name: 'OneDriveに保存', exact: true })).toBeDisabled();
  await expect(page.getByText('このPCの面談資料アプリを更新するとOneDriveへ直接保存できます。')).toBeVisible();
});
