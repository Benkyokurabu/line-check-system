import { test, expect } from '@playwright/test';

for (const staff of [true, false]) test(`contact detail registers ${staff ? 'staff without a student' : 'student with evidence'}`, async ({ page }) => {
  let alias = '';
  let group = '';
  const writes: Record<string, unknown>[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== String(test.info().project.use.baseURL)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/admin/contacts') return route.fulfill({ json: { contacts: [{ line_user_id: 'test-contact', display_name: 'Example.Teacher', alias_name: alias || null, group_name: group || null, pending_evidence: true }] } });
    if (url.pathname.endsWith('/messages')) return route.fulfill({ json: { messages: [{ id: 'evidence', direction: 'inbound', message_type: 'text', text: '担当の件、承知しました。', created_at: '2026-09-11T00:00:00Z' }], identity_evidence: null, registration_history: [] } });
    if (url.pathname === '/api/attendance/students') return route.fulfill({ json: { students: staff ? [] : [{ student_number: 'TEST', student_name: '試験生徒', grade: '中1', campus: '本校', instruction_type: '集団' }] } });
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON(); writes.push(body);
      if (staff) {
        expect(url.pathname).toBe('/api/admin/contacts/test-contact');
        expect(route.request().method()).toBe('PUT');
        alias = body.alias_name; group = body.group_name;
      } else {
        expect(url.pathname).toBe('/api/admin/contacts/test-contact/verify');
        alias = body.targets[0].alias_name;
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/contacts');
  await page.getByRole('button', { name: '生徒本人・保護者を登録', exact: true }).click();
  const choices = page.getByRole('group', { name: '1. LINEの利用者を選ぶ' });
  for (const label of ['生徒本人', '保護者', '先生・スタッフ', '本人・保護者で共有']) await expect(choices.getByRole('button', { name: new RegExp('^' + label + '$') })).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  if (staff) {
    await choices.getByRole('button', { name: /^先生・スタッフ$/ }).click();
    await expect(page.getByLabel('生徒を検索')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '先生・スタッフとして保存して一覧を更新' })).toBeDisabled();
    await page.getByLabel('先生・スタッフの登録名').fill('試験先生');
    await page.getByRole('button', { name: '先生・スタッフとして保存して一覧を更新' }).click();
    await expect(page.getByRole('status')).toContainText('試験先生 として登録しました');
    expect(writes).toEqual([{ alias_name: '試験先生', group_name: 'スタッフ' }]);
    await expect(page.getByRole('row').filter({ hasText: 'Example.Teacher' })).toContainText('試験先生');
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: 'Example.Teacher' })).toContainText('試験先生');
  } else {
    await choices.getByRole('button', { name: /^生徒本人$/ }).click();
    await page.getByLabel('生徒を検索').fill('試験生徒');
    await page.getByRole('button', { name: /TEST/ }).click();
    await page.getByLabel('LINE登録の確認者名').fill('試験職員');
    await expect(page.getByRole('button', { name: 'この内容で登録して一覧の名前を更新', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /担当の件/ }).click();
    await page.getByRole('button', { name: 'この内容で登録して一覧の名前を更新', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('本　試験生徒 として登録しました');
    expect(writes[0]).toMatchObject({ targets: [{ student_number: 'TEST', relation: 'student', alias_name: '本　試験生徒', is_primary: true }], evidence_message_id: 'evidence', verified_by: '試験職員' });
  }
});
