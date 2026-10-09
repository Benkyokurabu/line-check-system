import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appointment = { id: 'notion-1', number: '2018998', name: '確認用 生徒', grade: '中3', teacher: '工藤', teacherId: 'staff-1',
  date: '2026-10-05', start: '20:30', editedAt: '2026-10-05T00:00:00Z', source: 'notion-bensuke', url: 'https://www.notion.so/fixture' };
test('Notion source, review buttons, date changes and retry work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [{ number: '2018998', name: '確認用 生徒', grade: '中3', teacher: '佐藤', responses: [] }] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [] } }));
  await page.route('**/api/staff/interview-material-context**', route => route.fulfill({ json: { records: [], info: [], summary: { status: 'empty', items: [] } } }));
  let reads = 0;
  await page.route('**/api/staff/interview-material-appointments**', route => {
    reads++;
    const date = new URL(route.request().url()).searchParams.get('date');
    return route.fulfill({ json: { source: 'notion-bensuke', appointments: date === '2026-10-05' ? [appointment] : [], review: [{ id: 'review-1', title: '同名の生徒の教育相談', reason: '生徒台帳と一意に照合できません。', url: 'https://www.notion.so/reviewfixture' }] } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByLabel('面談日').fill('2026-10-05');
  await expect(page.getByText('取得元：Notionベンケイ。', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '要確認 1件（保存対象外）' })).toBeVisible();
  const review = page.getByLabel('要確認の面談予定');
  await expect(review.getByRole('button')).toHaveCount(0);
  await expect(review.getByRole('link', { name: 'Notionで予定を確認' })).toHaveAttribute('href', 'https://www.notion.so/reviewfixture');
  const dimensions = await review.getByRole('link').boundingBox();
  expect(dimensions!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: /20:30.*中3 確認用 生徒/ }).click();
  await expect(page.getByText('保存予定：', { exact: false })).toContainText('工藤先生／2026.10.05.2030-中３確認用生徒');
  await expect(page.getByRole('link', { name: '選んだ面談のNotion原本を開く' })).toHaveAttribute('href', appointment.url);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-date-folders-mobile.png', fullPage: true });
  await page.getByLabel('面談日').fill('2026-10-06');
  await expect(page.getByText('保存予定：', { exact: false })).toHaveCount(0);
  await expect(page.getByText('この日に保存できる面談予定はありません。')).toBeVisible();
  await page.getByRole('button', { name: 'Notionの予定を再取得' }).click();
  await expect.poll(() => reads).toBe(3);
  await page.getByLabel('面談日').fill('');
  await expect(page.getByRole('button', { name: 'Notionの予定を再取得' })).toBeDisabled();
  await expect(page.getByText('面談予定を読み込んでいます…')).toHaveCount(0);
});
test('appointments are unavailable without a staff session', async ({ request }) => {
  const response = await request.get('/api/staff/interview-material-appointments?date=2026-10-05');
  expect(response.status()).toBe(401); expect(await response.json()).not.toHaveProperty('appointments');
});
test('folder design shows both grades and usable transitions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(resolve('docs/interview-date-folder-design-20261005.html')).href);
  await expect(page.getByRole('button', { name: '③ 面談用フォルダを保存' })).toBeDisabled();
  await page.getByRole('button', { name: '① 面談予定を選ぶ' }).click();
  await page.getByRole('button', { name: '② 資料を作る' }).click();
  await page.getByRole('button', { name: '③ 面談用フォルダを保存' }).click();
  await expect(page.getByRole('status')).toContainText('Notionを保存直前に再確認');
  await page.getByLabel('説明用の学年').selectOption('中２');
  await expect(page.locator('#tree')).toContainText('2026中２秋の教育相談会');
  await page.getByRole('button', { name: '日付を変更する' }).click();
  await expect(page.getByRole('button', { name: '③ 面談用フォルダを保存' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-date-folder-design-mobile.png', fullPage: true });
});
