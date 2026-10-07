import { expect, test } from '@playwright/test';

test('button queues confirmed appointments on the online PC, and reopening never starts a run', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [{ id: '11111111-1111-4111-8111-111111111111', display_name: '確認用' }] } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [{ id: 'standby', priority: 2 }] } }));
  let submissions = 0, status = 'idle', online = true, failed = false;
  const appointment = { date: '2030-01-02', start: '21:30', name: '確認用生徒', teacher: '確認用' };
  const review = [{id:'review-a',title:'小６ 確認用の姓／面談',date:'2030-01-02',start:'18:30',teachers:['確認用'],reason:'生徒のフルネームを確認してください。',url:'https://www.notion.so/11111111111141118111111111111111'},
    {id:'review-b',title:'確認用の面談',date:'2030-01-02',start:'',teachers:[],reason:'日時・担当者を確認してください。',url:'https://www.notion.so/22222222222242228222222222222222'}];
  await page.route('**/api/staff/interview-material-run**', async route => {
    if(new URL(route.request().url()).searchParams.get('review')==='1') {
      if(failed) return route.fulfill({status:503,json:{error:'確認対象を取得できません。'}});
      return route.fulfill({json:{review,reviewCount:2,from:'2030-01-02',to:'2030-01-09'}});
    }
    if (route.request().method() === 'POST') {
      submissions++;
      const body = route.request().postDataJSON();
      expect(body.runId).toMatch(/^[a-f0-9-]{36}$/);
      expect(body.teacherId).toBe('11111111-1111-4111-8111-111111111111');
      status = 'queued';
      return route.fulfill({ status: 201, json: { accepted: 1, worker: '予備PC', reviewCount: 2, review, from:'2030-01-02',to:'2030-01-09' } });
    }
    if (failed) return route.fulfill({ status: 503, json: { error: '状況を取得できません。' } });
    return route.fulfill({ json: { workers: online ? [{ id: 'standby', name: '予備PC' }] : [], jobs: status === 'idle' ? [] : [{
      id: 'job', status, appointment, savedFolder: status === 'completed' ? '\\\\NAS\\98面談資料\\確認用先生' : null,
      skipped: false, missing: [], attempts: 1,
    }] } });
  });
  await page.goto('/staff/interview-materials');
  const panel = page.getByRole('region', { name: '確定面談の一括作成' });
  await expect(panel.getByRole('button', { name: '面談資料作成', exact: true })).toBeEnabled();
  expect(submissions).toBe(0);
  await panel.getByRole('button',{name:'確認が必要な予定を見る',exact:true}).click();
  const reviewPanel=panel.getByRole('region',{name:'確認が必要な予定',exact:true});
  await expect(reviewPanel.getByRole('heading',{name:'確認が必要な予定（2件）'})).toBeVisible();
  await expect(reviewPanel.getByText(/小６ 確認用の姓/)).toBeVisible();
  await expect(reviewPanel.getByText('担当：担当者未確認')).toBeVisible();
  await expect(reviewPanel.getByText('確認理由：生徒のフルネームを確認してください。')).toBeVisible();
  await expect(reviewPanel.getByRole('link',{name:'Notionで元の予定を確認'}).first()).toHaveAttribute('href',review[0].url);
  expect(submissions).toBe(0);
  const startDate = await panel.getByLabel('作成対象の開始日').inputValue();
  const expectedEnd = new Date(Date.parse(startDate) + 7 * 86400000).toISOString().slice(0, 10);
  await expect(panel.getByLabel('作成対象の終了日')).toHaveValue(expectedEnd);
  const nextDay = new Date(Date.parse(startDate) + 86400000).toISOString().slice(0, 10);
  await panel.getByLabel('作成対象の開始日').fill(nextDay);
  await expect(panel.getByLabel('作成対象の終了日')).toHaveValue(new Date(Date.parse(nextDay) + 7 * 86400000).toISOString().slice(0, 10));
  await panel.getByLabel('一括作成の先生').selectOption('11111111-1111-4111-8111-111111111111');
  await panel.getByRole('button', { name: '面談資料作成', exact: true }).click();
  await expect(panel.getByText(/1件の作成を受け付けました。予備PC/)).toBeVisible();
  await expect(reviewPanel.getByRole('heading',{name:'確認が必要な予定（2件）'})).toBeVisible();
  await expect(panel.getByRole('button', { name: '面談資料を作成中', exact: true })).toBeDisabled();
  expect(submissions).toBe(1);
  status = 'completed';
  await panel.getByRole('button', { name: '作成状況を再確認' }).click();
  await expect(panel.getByText('共有フォルダへ保存済み', { exact: true })).toBeVisible();
  failed = true;
  await panel.getByRole('button', { name: '作成状況を再確認' }).click();
  await expect(panel.getByRole('alert')).toContainText('状況を取得できません。');
  await expect(panel.getByText('共有フォルダへ保存済み', { exact: true })).toBeVisible();
  failed = false; online = false;
  await page.reload();
  await expect(panel.getByText(/一括作成に対応したPCが停止中/)).toBeVisible();
  await expect(panel.getByRole('button', { name: '面談資料作成', exact: true })).toBeDisabled();
  await panel.getByRole('button',{name:'確認が必要な予定を見る',exact:true}).click();
  await expect(reviewPanel.getByText(/小６ 確認用の姓/)).toBeVisible();
  failed=true;
  await panel.getByRole('button',{name:'確認が必要な予定を見る',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('確認対象を取得できません。');
  await expect(reviewPanel.getByText(/小６ 確認用の姓/)).toBeVisible();
  expect(submissions).toBe(1);
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-manual-status-mobile.png', fullPage: true });
});
