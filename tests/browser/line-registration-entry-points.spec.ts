import { expect, test, type Page } from '@playwright/test';
const student = { student_number: 'UI-ONE', student_name: '試験一郎', grade: '高3', campus: '本校', homeroom_teacher: '試験先生', instruction_type: '個別ほか', school_name: '試験学校', line_user_id: null, message_count: 0, latest_at: null };
const sibling = { ...student, student_number: 'UI-TWO', student_name: '試験二郎' };
async function setup(page: Page) {
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      expect(path).toBe('/api/admin/contacts/ui-line/verify');
      expect(route.request().method()).toBe('POST');
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/admin/teachers') return route.fulfill({ json: { teachers: [{ display_name: '試験先生' }] } });
    if (path === '/api/students' || path === '/api/attendance/students') return route.fulfill({ json: { students: [student, sibling] } });
    if (path === '/api/admin/contacts') return route.fulfill({ json: { contacts: [{ line_user_id: 'ui-line', display_name: '登録試験LINE', pending_evidence: true }] } });
    if (path === '/api/admin/contacts/ui-line/messages') return route.fulfill({ json: { messages: [{ id: 'ui-evidence', text: '試験一郎と試験二郎の保護者です。', direction: 'inbound', message_type: 'text' }], registration_history: [] } });
    if (path.startsWith('/api/students/') && path.endsWith('/messages')) return route.fulfill({ json: { student, link_status: 'unlinked', messages: [] } });
    if (path === '/api/attendance/line-link-candidates') return route.fulfill({ json: { candidates: [{ line_user_id: 'ui-line', display_name: '登録試験LINE', default_student_number: 'UI-ONE', evidence_message_id: 'ui-evidence', latest_text: '試験一郎と試験二郎の保護者です。', suggestions: [], suggested_names: [] }] } });
    return route.fulfill({ json: {} });
  });
  return writes;
}
for (const entry of ['candidates', 'students']) test(`${entry} opens the same registration form without writing and registers siblings together`, async ({ page }) => {
  const writes = await setup(page);
  if (entry === 'candidates') {
    await page.goto('/attendance');
    await page.getByRole('button', { name: '生徒本人・保護者のLINE登録候補を表示', exact: true }).click();
    await page.getByRole('button', { name: '生徒本人・保護者を登録', exact: true }).click();
  } else {
    await page.goto('/students');
    await page.getByRole('row').filter({ hasText: 'UI-ONE' }).click();
    await page.getByPlaceholder('LINE名・登録名で検索').fill('登録試験LINE');
    await page.getByRole('button', { name: '登録試験LINE', exact: true }).click();
  }
  const form = page.getByRole('region', { name: '生徒本人・保護者のLINE登録', exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByRole('group', { name: '1. LINEの利用者を選ぶ' })).toBeVisible();
  expect(writes).toHaveLength(0);
  await form.getByRole('button', { name: '保護者', exact: true }).click();
  await form.getByLabel('保護者の続柄').selectOption('mother');
  await form.getByLabel('生徒を検索', { exact: true }).fill('試験二郎');
  await form.getByRole('button', { name: /UI-TWO/ }).click();
  await form.getByLabel('登録後に一覧へ表示する名前（試験一郎）', { exact: true }).fill('確認した管理名');
  await form.getByLabel('LINE登録の確認者名').fill('確認職員');
  await form.getByRole('button', { name: '試験一郎と試験二郎の保護者です。', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await form.getByRole('button', { name: 'この内容で登録して一覧の名前を更新' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ evidence_message_id: 'ui-evidence', verified_by: '確認職員', source: entry === 'candidates' ? 'attendance_line_review' : 'students_review', targets: [
    { student_number: 'UI-ONE', relation: 'mother', alias_name: '確認した管理名', is_primary: false },
    { student_number: 'UI-TWO', relation: 'mother', alias_name: '本　試験二郎　母', is_primary: false },
  ] });
});

test('shared registration fits mobile and can close without a write', async ({ page }) => {
  const writes = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/contacts');
  await page.getByRole('button', { name: '生徒本人・保護者を登録', exact: true }).click();
  const form = page.getByRole('region', { name: '生徒本人・保護者のLINE登録', exact: true });
  await form.getByRole('button', { name: '生徒本人', exact: true }).click();
  await form.getByLabel('生徒を検索', { exact: true }).fill('個別');
  await expect(form.getByRole('button', { name: /UI-ONE/ })).toBeVisible();
  const box = await form.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/shared-registration-mobile.png', fullPage: true });
  await form.getByRole('button', { name: 'LINE登録を閉じる' }).click();
  await expect(form).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
