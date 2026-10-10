import { expect, test } from '@playwright/test';

test('long manual range retries only the uncertain chunk with the same run ID', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'standby', priority: 2 }] } }));
  const chunks: number[] = [];
  const runIds: string[] = [];
  let failOnce = true;
  let queued = false;
  await page.route('**/api/staff/interview-material-run**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      chunks.push(body.chunk);
      runIds.push(body.runId);
      if (body.chunk === 1 && failOnce) {
        failOnce = false;
        return route.fulfill({ status: 503, json: { error: '一時的な取得失敗' } });
      }
      queued = true;
      return route.fulfill({ status: 201, json: { accepted: 1, worker: '予備PC', review: [], chunk: body.chunk, chunkCount: 3 } });
    }
    return route.fulfill({ json: { workers: [{ id: 'standby', name: '予備PC' }], jobs: queued ? [{
      id: 'job', status: 'queued', appointment: { date: '2030-01-01', start: '10:00', name: '検証用', teacher: '担当' },
      skipped: false, missing: [], attempts: 0,
    }] : [] } });
  });
  await page.goto('/staff/interview-materials');
  const panel = page.getByRole('region', { name: '確定面談の一括作成' });
  await expect(panel.getByRole('button', { name: '面談資料作成', exact: true })).toBeEnabled();
  const from = await panel.getByLabel('作成対象の開始日').inputValue();
  const end = new Date(Date.parse(from) + 16 * 86400000).toISOString().slice(0, 10);
  await panel.getByLabel('作成対象の終了日').fill(end);
  await panel.getByRole('button', { name: '面談資料作成', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('一時的な取得失敗');
  await expect(panel.getByText('1件は受付済みです。残りの期間を同じ依頼番号で再試行できます。')).toBeVisible();
  await panel.getByRole('button', { name: '作成状況を再確認' }).click();
  await expect(panel.getByRole('button', { name: '残りの期間を再試行' })).toBeEnabled();
  await panel.getByRole('button', { name: '残りの期間を再試行' }).click();
  await expect(panel.getByText(/3件の作成を受け付けました。予備PC/)).toBeVisible();
  expect(chunks).toEqual([0, 1, 1, 2]);
  expect(new Set(runIds).size).toBe(1);
  await page.reload();
  expect(chunks).toEqual([0, 1, 1, 2]);
});

test('reloading after a partial run does not submit remaining chunks', async ({ page }) => {
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'standby', priority: 2 }] } }));
  const chunks: number[] = [];
  await page.route('**/api/staff/interview-material-run**', route => {
    if (route.request().method() === 'POST') {
      const chunk = route.request().postDataJSON().chunk;
      chunks.push(chunk);
      if (chunk === 1) return route.fulfill({ status: 503, json: { error: '一時的な取得失敗' } });
      return route.fulfill({ status: 201, json: { accepted: 1, worker: '予備PC', review: [], chunk, chunkCount: 3 } });
    }
    return route.fulfill({ json: { workers: [{ id: 'standby', name: '予備PC' }], jobs: [] } });
  });
  await page.goto('/staff/interview-materials');
  const panel = page.getByRole('region', { name: '確定面談の一括作成' });
  const from = await panel.getByLabel('作成対象の開始日').inputValue();
  await panel.getByLabel('作成対象の終了日').fill(new Date(Date.parse(from) + 16 * 86400000).toISOString().slice(0, 10));
  await panel.getByRole('button', { name: '面談資料作成', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('一時的な取得失敗');
  expect(chunks).toEqual([0, 1]);
  await page.reload();
  await expect(panel.getByRole('button', { name: '面談資料作成', exact: true })).toBeEnabled();
  expect(chunks).toEqual([0, 1]);
});
