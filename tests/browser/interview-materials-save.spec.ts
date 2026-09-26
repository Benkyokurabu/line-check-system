import { expect, test } from '@playwright/test';

const teacherId = '00000000-0000-4000-8000-000000000003';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: {
    teachers: [{ id: teacherId, display_name: '工藤' },
      { id: '00000000-0000-4000-8000-000000000004', display_name: '金城' }],
  } }));
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

test('central worker previews sources then builds and saves a PDF without browser loopback access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const jobs: string[] = [];
  let generatedIds: string[] = [];
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
      items: [{ label: '指導簿', source: 'guide', staffOnly: false }], missing: [], pages: 12,
      savedPath: 'C:\\Users\\test\\OneDrive\\面談準備\\保存済み資料\\sample.pdf', cloudSynced: true,
    } } } });
  });
  await page.route('http://127.0.0.1:38473/**', route => { throw Error(`unexpected loopback request: ${route.request().url()}`); });
  await page.goto('/staff/interview-materials');
  await expect(page.getByText('主担当PCが稼働中です')).toBeVisible();
  await page.getByRole('button', { name: /中3 確認用 生徒/ }).click();
  await expect(page.getByRole('heading', { name: 'アンケート回答', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '第3志望' })).toHaveValue('叡明');
  await page.getByRole('button', { name: '資料を作る' }).click();
  await expect(page.locator('li').filter({ hasText: '第2志望：国府台' })).toContainText('該当資料なし');
  await expect(page.getByRole('checkbox', { name: /面談アンケート回答/ })).toBeChecked();
  await expect(page.getByText('選択中 4点 ／ 見つかった資料 4点')).toBeVisible();
  await page.getByRole('checkbox', { name: /柏の葉 ／ 高校案内/ }).uncheck();
  await expect(page.getByText('選択中 3点 ／ 見つかった資料 4点')).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'analysis_outputs/interview-materials-print-selection-live-mobile.png', fullPage: true });
  expect(jobs).toEqual(['preview']);
  await page.getByRole('button', { name: '選んだ3点でPDFを作成' }).click();
  await expect(page.getByRole('heading', { name: '3. 資料を確認・印刷' })).toBeVisible();
  await expect(page.getByRole('link', { name: '先生用の一式PDFを表示・印刷' })).toHaveAttribute('href', 'https://example.com/signed.pdf');
  await expect(page.getByText('作成PCとOneDriveのクラウドに保存しました', { exact: false })).toBeVisible();
  expect(jobs).toEqual(['preview', 'generate']);
  expect(generatedIds).toEqual(['guide', 'survey', 'term-report']);
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
