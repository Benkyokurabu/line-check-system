import { expect, test } from '@playwright/test';

test('a middle second year survey without schools offers multiple past-record choices', async ({ page }) => {
  const answerId = '11111111-1111-4111-8111-111111111111';
  let requestedSchools: string[] = [];
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers: [] } }));
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { role: 'teacher' } } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [{
    number: '2019032', name: '確認用 生徒', grade: '中2', teacher: '工藤', responses: [{
      id: answerId, date: '2026-09-01', schools: [], fields: [], url: 'https://notion.so/survey',
    }],
  }] } }));
  await page.route('**/api/staff/interview-material-context**', route => route.fulfill({ json: {
    records: [], schoolMentions: [], schoolCandidates: [
      { name: '大宮', date: '2026-04-18', text: '大宮（普通科）の基準偏差値', url: 'https://notion.so/a' },
      { name: '草加東', date: '2026-05-01', text: '草加東高校が話題に出た', url: 'https://notion.so/b' },
    ], info: [], summary: { status: 'empty', items: [] }, studentUrl: '', source: 'notion',
  } }));
  await page.route('**/api/staff/interview-material-jobs**', route => {
    if (route.request().method() === 'POST') {
      requestedSchools = route.request().postDataJSON().schools;
      return route.fulfill({ status: 201, json: { id: 'preview-id' } });
    }
    if (new URL(route.request().url()).searchParams.has('id')) return route.fulfill({ json: { job: {
      status: 'completed', result: { schools: [], materials: [] },
    } } });
    return route.fulfill({ json: { available: [{ id: 'primary', priority: 1 }] } });
  });
  await page.goto('/staff/interview-materials');
  await page.getByRole('button', { name: /確認用 生徒/ }).click();
  await page.getByRole('checkbox', { name: /大宮/ }).check();
  await page.getByRole('checkbox', { name: /草加東/ }).check();
  await expect(page.getByLabel('資料候補 1')).toHaveValue('大宮');
  await expect(page.getByLabel('資料候補 2')).toHaveValue('草加東');
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect.poll(() => requestedSchools).toEqual(['大宮', '草加東']);
});
