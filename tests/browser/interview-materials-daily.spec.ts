import { expect, test } from '@playwright/test';

test('daily status explains stopped scheduling and preserves failed-job context on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'admin' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [] } }));
  let fail = false, requests = 0;
  await page.route('**/api/staff/interview-material-daily', route => {
    requests++;
    if (fail) return route.fulfill({ status: 503, json: { error: '状況の取得に失敗しました。' } });
    return route.fulfill({ json: {
      settings: { enabled: false, run_time: '06:00:00', days_ahead: 7 },
      scans: [{ target_date: '2030-01-02', status: 'completed', report: { review: [{}], changed: [{}] } }],
      jobs: [
        { id: 'done', status: 'completed', appointment: { date: '2030-01-02', start: '19:00', name: '確認用生徒A', teacher: '確認用' }, savedFolder: '\\\\NAS\\98面談資料\\確認用先生\\生徒A', missing: [], attempts: 1, skipped: false },
        { id: 'failed', status: 'failed', appointment: { date: '2030-01-02', start: '20:00', name: '確認用生徒B', teacher: '確認用' }, error: '共有フォルダに接続できません。以前の資料は保持しています。', missing: [], attempts: 1, skipped: false },
      ],
    } });
  });
  await page.goto('/staff/interview-materials');
  await expect(page.getByRole('heading', { name: '1. 生徒を選ぶ' })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByText('毎日の自動作成・保存状況', { exact: true }).click();
  await expect(page.getByText('毎日の自動作成は停止中です。', { exact: true })).toBeVisible();
  await expect(page.getByText(/要確認 1件/)).toBeVisible();
  const results = page.getByRole('list', { name: '自動作成の結果' });
  await expect(results.getByText('共有フォルダへ保存済み', { exact: true })).toBeVisible();
  await expect(results.getByText(/以前の資料は保持しています/)).toBeVisible();
  await expect(results.getByText(/5分後に再試行/)).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-daily-status-mobile.png', fullPage: true });
  fail = true;
  await page.getByRole('button', { name: '自動作成の状況を再確認' }).click();
  await expect(page.getByText('状況の取得に失敗しました。', { exact: true })).toBeVisible();
  await expect(results.getByText('共有フォルダへ保存済み', { exact: true })).toBeVisible();
});
