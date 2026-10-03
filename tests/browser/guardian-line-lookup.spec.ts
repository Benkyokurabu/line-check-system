import { test, expect, type BrowserContext } from '@playwright/test';
const answer = '11111111-1111-4111-8111-111111111111';
const number = '2019001', name = '架空 花子';
const motherId = 'U' + '1'.repeat(32), fatherId = 'U' + '2'.repeat(32), otherId = 'U' + '3'.repeat(32);
const entry = '/contacts?' + new URLSearchParams({ source: 'survey-workflow', student: number, studentName: name });
const account = (relation: string, status: string, studentNumber = number) => ({ student_number: studentNumber, student_name: name, grade: '中2', relation, verification_status: status, instruction_type: '集団' });
async function setup(context: BrowserContext, options: { noGuardian?: boolean; failed?: boolean; confirmedSibling?: boolean } = {}) {
  const writes: string[] = [];
  let fail = options.failed === true;
  let reads = 0;
  const contacts = [
    { line_user_id: motherId, display_name: 'はなの母', alias_name: '本 架空花子 母', group_name: '保護者', system_verified: !options.noGuardian, registered_accounts: options.noGuardian ? [] : [account('mother', 'confirmed')] },
    { line_user_id: fatherId, display_name: 'はなの父', alias_name: '本 架空 花子 父', group_name: null, pending_evidence: true, registered_accounts: options.noGuardian ? [] : [account('father', 'unverified')] },
    { line_user_id: otherId, display_name: '別の花子の母', alias_name: '本 架空太郎・花子 母（別生徒）', group_name: 'その他', registered_accounts: [{ ...account('mother', 'unverified', '2019002'), student_name: '架空 太郎' }] },
  ];
  if (options.confirmedSibling) { contacts[0].registered_accounts = [{ ...account('mother', 'confirmed', '2019002'), student_name: '架空 太郎' }]; contacts[0].system_verified = true; }
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== 'GET') { writes.push(path); return route.fulfill({ status: 403, json: { error: 'この検証では更新・送信は禁止' } }); }
    if (path === '/api/admin/contacts') return route.fulfill(fail ? { status: 503, json: { error: '連絡先の読み込みに失敗しました' } } : { json: { contacts: url.searchParams.has('userId') ? contacts.filter(c => c.line_user_id === url.searchParams.get('userId')) : contacts } });
    if (path === '/api/staff/survey-workflow') { reads++; return route.fulfill({ json: { student: { name, number, grade: '中2' }, staffName: '試験職員', survey: { id: answer, url: 'https://example.invalid', date: '2026-10-03', time: '18:00', editedAt: 'v1' }, bensuke: { state: 'synced', method: '３者Zoom', endTime: '18:45', styled: true }, accounts: [], record: null } }); }
    if (path === '/api/interview-surveys') return route.fulfill({ json: { groups: [{ teacher: '工藤', students: [{ grade: '中2', name, notionUrl: `https://www.notion.so/${answer.replaceAll('-', '')}`, submittedAt: '2026-10-01T00:00:00Z' }] }] } });
    if (path === '/api/interview-surveys/confirmations') return route.fulfill({ json: { states: [] } });
    if (path === '/api/interview-surveys/scheduling') return route.fulfill({ json: { states: {} } });
    if (path.endsWith('/messages')) return route.fulfill({ json: { messages: [], registration_history: [] } });
    if (path === '/api/admin/contacts/students') return route.fulfill({ json: { students: [{ student_number: number, student_name: name, grade: '中2', campus: '本校', instruction_type: '集団' }, { student_number: '2019002', student_name: '架空 太郎', grade: '中2', campus: '本校', instruction_type: '集団' }] } });
    return route.fulfill({ json: {} });
  });
  return { writes, recover: () => { fail = false; }, readCount: () => reads };
}

for (const width of [390, 1280]) test(`survey → search → registration → return preserves the interview draft (${width}px)`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 844 });
  const state = await setup(context, { noGuardian: true });
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'アンケートの生徒を検索' }).fill(name);
  await page.getByRole('button', { name: `${name}：日程連絡・面談記録・LINE`, exact: true }).click();
  const ui = page.getByRole('region', { name: '面談入力' });
  const schedule = ui.getByRole('heading', { name: '2　日程をLINEで連絡する' }).locator('..');
  await schedule.getByLabel('日程連絡の文面').fill('面談の確認用下書き');
  const popupPromise = context.waitForEvent('page');
  await schedule.getByRole('link', { name: '保護者LINEを確認・登録 ↗', exact: true }).click();
  const contacts = await popupPromise;
  await contacts.setViewportSize({ width, height: 844 });
  await expect(contacts.getByRole('searchbox', { name: 'LINE連絡先を検索' })).toHaveValue(name);
  await expect(contacts.getByText('登録済みの保護者LINE：0件')).toBeVisible();
  await expect(contacts.getByRole('table', { name: '連絡先一覧' }).getByRole('row')).toHaveCount(4);
  const box = await contacts.locator('#contact-search').boundingBox();
  expect(box).not.toBeNull(); expect(box!.y + box!.height).toBeLessThan(844);
  await contacts.screenshot({ path: `analysis_outputs/guardian-line-lookup/entry-${width}.png`, fullPage: false });
  const mother = contacts.getByRole('row').filter({ hasText: 'はなの母' });
  await expect(mother.getByText('生徒・続柄の登録なし')).toBeVisible();
  await mother.getByRole('link', { name: '生徒・保護者の登録を確認・修正', exact: true }).click();
  await expect(contacts).toHaveURL(new RegExp('/line-registration\\?.*student=' + number));
  await expect(contacts.getByText('現在の確認済み紐付け：なし')).toBeVisible();
  await expect(contacts.getByRole('region', { name: '生徒本人・保護者のLINE登録', exact: true })).toContainText(name);
  await contacts.getByRole('button', { name: '← 連絡先管理に戻る', exact: true }).click();
  await expect(contacts.locator('#contact-search')).toHaveValue(name);
  expect(await contacts.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await contacts.screenshot({ path: `analysis_outputs/guardian-line-lookup/contacts-${width}.png`, fullPage: false });
  const closed = contacts.waitForEvent('close');
  await contacts.getByRole('button', { name: '確認を終えて元の面談タブに戻る' }).click();
  await closed;
  await expect(schedule.getByLabel('日程連絡の文面')).toHaveValue('面談の確認用下書き');
  const previousReads = state.readCount();
  await schedule.getByRole('button', { name: 'LINE宛先を読み直す' }).click();
  await expect.poll(state.readCount).toBe(previousReads + 1);
  await expect(schedule.getByLabel('日程連絡の文面')).toHaveValue('面談の確認用下書き');
  expect(state.writes).toEqual([]);
});

test('exact student-number registration is distinct from matching names across all states', async ({ page, context }) => {
  const { writes } = await setup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(entry);
  const target = page.getByRole('region', { name: '対象生徒の保護者LINE登録状況' });
  await expect(target.getByText('登録済みの保護者LINE：2件')).toBeVisible();
  await expect(target).toContainText('母・本 架空花子 母');
  await expect(target).toContainText('父・本 架空 花子 父');
  await expect(target).not.toContainText('別生徒');
  await page.getByRole('searchbox', { name: 'LINE連絡先を検索' }).fill('架空　花子');
  await expect(page.getByRole('table', { name: '連絡先一覧' }).getByRole('row')).toHaveCount(4);
  await page.getByRole('button', { name: '本人確認済み 1', exact: true }).click();
  await expect(page.getByRole('table', { name: '連絡先一覧' }).getByRole('row')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'グループで絞り込み' }).selectOption('その他');
  await expect(page.getByText('条件に一致するLINE連絡先がありません')).toBeVisible();
  await page.getByRole('searchbox', { name: 'LINE連絡先を検索' }).fill('架空 花子');
  await expect(page.getByRole('table', { name: '連絡先一覧' }).getByRole('row')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'LINE連絡先を検索' }).fill('一致しない');
  await page.getByRole('button', { name: 'すべてのLINE連絡先を表示' }).click();
  await expect(page.locator('#contact-search')).toHaveValue('');
  await expect(page.getByRole('table', { name: '連絡先一覧' }).getByRole('row')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'LINE登録名を同期する', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'グループへ一斉送信', exact: true })).toBeVisible();
  await page.screenshot({ path: 'analysis_outputs/guardian-line-lookup/registered-mobile.png', fullPage: true });
  expect(writes).toEqual([]);
});

test('normal contact search finds confirmed contacts without manually changing tabs', async ({ page, context }) => {
  const { writes } = await setup(context);
  await page.goto('/contacts');
  await expect(page.getByRole('button', { name: '要確認 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: 'LINE連絡先を検索' }).fill('はなの母');
  await expect(page.getByRole('row').filter({ hasText: 'はなの母' })).toContainText('本人確認済み');
  await expect(page.getByRole('button', { name: 'すべて 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(writes).toEqual([]);
});

test('failed loading is reported as unknown, never as an unregistered guardian', async ({ page, context }) => {
  const state = await setup(context, { failed: true });
  await page.goto(entry);
  await expect(page.getByRole('alert').filter({ hasText: '連絡先の読み込みに失敗しました' })).toBeVisible();
  await expect(page.getByText(/登録済みの保護者LINE：0件/)).toHaveCount(0);
  state.recover(); await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByText('登録済みの保護者LINE：2件')).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('existing confirmed sibling is preserved and the target student remains explicit', async ({ page, context }) => {
  const { writes } = await setup(context, { confirmedSibling: true, noGuardian: true });
  await page.goto(entry);
  await expect(page.getByText('登録済みの保護者LINE：0件')).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'はなの母' }).getByRole('link', { name: '生徒・保護者の登録を確認・修正', exact: true }).click();
  await expect(page.getByRole('region', { name: '今回確認する生徒', exact: true })).toContainText(name);
  await expect(page.getByText(/^現在の確認済み紐付け：/)).toContainText('架空 太郎（母）');
  const form = page.getByRole('region', { name: '生徒本人・保護者のLINE登録', exact: true });
  await expect(form).toContainText('架空 太郎');
  await form.getByLabel('生徒を検索', { exact: true }).fill('架空 花子');
  await expect(form.getByRole('button', { name: /2019001/ })).toBeVisible();
  expect(writes).toEqual([]);
});
