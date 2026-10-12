import { expect, test } from '@playwright/test';

test('31 days submit four chunks sequentially and reviews use the same range without generation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } }));
  const submissions: { runId: string; from: string; to: string; chunk: number }[] = [];
  const reviews: number[] = [];
  let active = 0, maxActive = 0;
  await page.route('**/api/staff/interview-material-run**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' || url.searchParams.get('review') === '1') {
      active++; maxActive = Math.max(maxActive, active);
      if (route.request().method() === 'POST') submissions.push(route.request().postDataJSON());
      else reviews.push(Number(url.searchParams.get('chunk')));
      await new Promise(resolve => setTimeout(resolve, 30));
      active--;
      return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200,
        json: { accepted: 0, worker: '主担当PC', review: [], chunkCount: 4 } });
    }
    return route.fulfill({ json: { workers: [{ id: 'primary', name: '主担当PC' }], jobs: [] } });
  });
  await page.goto('/staff/interview-materials');
  const panel = page.getByRole('region', { name: '確定面談の一括作成' });
  const button = panel.getByRole('button', { name: '面談資料作成', exact: true });
  await expect(button).toBeEnabled();
  const from = await panel.getByLabel('作成対象の開始日').inputValue();
  const to = new Date(Date.parse(from) + 30 * 86400000).toISOString().slice(0, 10);
  await panel.getByLabel('作成対象の終了日').fill(to);
  await panel.getByRole('button', { name: '確認が必要な予定を見る', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '確認が必要な予定（0件）' })).toBeVisible();
  expect(reviews).toEqual([0, 1, 2, 3]);
  expect(submissions).toHaveLength(0);
  await button.click();
  await expect(panel.getByText('選んだ範囲に、これから実施する確定面談はありません。')).toBeVisible();
  expect(submissions.map(s => s.chunk)).toEqual([0, 1, 2, 3]);
  expect(new Set(submissions.map(s => s.runId)).size).toBe(1);
  expect(submissions.every(s => s.from === from && s.to === to)).toBe(true);
  expect(maxActive).toBe(1);
  expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(button).toBeEnabled();
  expect(submissions).toHaveLength(4);
});
