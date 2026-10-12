import { test, expect, type Page } from '@playwright/test';
import { initialLoginNames } from '../../src/lib/staff-login-directory.mjs';
const teachers = initialLoginNames.map((display_name, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, display_name }));
async function commonMocks(page: Page) {
  await page.route('**/api/staff/login-people', route => route.fulfill({ json: { teachers } }));
  await page.route('**/api/admin/teachers', route => route.fulfill({ json: { teachers } }));
  await page.route('**/api/staff/interview-availability-copy*', route => route.fulfill({ json: { teachers: [], defaultTeacherId: '' } }));
  await page.route('**/api/staff/interview-materials', route => route.fulfill({ json: { students: [] } }));
  await page.route('**/api/staff/interview-material-appointments**', route => route.fulfill({ json: { appointments: [], review: [] } }));
  await page.route('**/api/staff/interview-material-jobs**', route => route.fulfill({ json: { available: [] } }));
  await page.route('**/api/staff/interview-material-run**', route => route.fulfill({ json: { workers: [], jobs: [] } }));
}
test('copy logs in in place, exposes all 21 people and shares login with creation and materials until logout', async ({ page }) => {
  await commonMocks(page); await page.setViewportSize({ width: 390, height: 844 });
  let authenticated = false, logins = 0;
  const staff = { staffId: 'fixture', staffCode: 'AVAIL_FIXTURE', displayName: '金城', role: 'teacher' };
  await page.route('**/api/staff/session/activity', route => route.fulfill({ json: { authenticated } }));
  await page.route('**/api/staff/session', route => {
    if (route.request().method() === 'DELETE') { authenticated = false; return route.fulfill({ json: { loggedOut: true } }); }
    return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { staff } : { error: 'ログインしてください。' } });
  });
  await page.route('**/api/staff/availability-login', route => {
    logins++; const body = route.request().postDataJSON();
    expect(body.teacherId).toBe(teachers[0].id);
    if (body.password === 'incorrect') return route.fulfill({ status: 401, json: { error: 'パスワードを確認してください。' } });
    authenticated = true; return route.fulfill({ json: { staff } });
  });
  await page.goto('/staff/interview-availability/manual');
  const form = page.getByRole('form', { name: '職員ログイン' });
  await expect(form.getByLabel('先生の名前').locator('option')).toHaveText(['選択してください', ...initialLoginNames.map(name => `${name}先生`)]);
  await form.getByLabel('先生の名前').selectOption(teachers[0].id);
  await form.getByLabel('共通パスワード').fill('incorrect'); await form.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('パスワード'); await expect(form.getByLabel('共通パスワード')).toHaveValue('');
  await form.getByLabel('共通パスワード').fill('fixture-password'); await form.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('region', { name: '予約可能枠をコピー' })).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/interview-availability\/manual$/);
  await page.goto('/staff/interview-availability'); await expect(page.getByRole('region', { name: '自分の予約可能枠' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '先生ログイン' })).toHaveCount(0);
  await page.goto('/staff/interview-materials'); await expect(page.getByRole('region', { name: '確定面談の一括作成' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '先生ログイン' })).toHaveCount(0);
  expect(logins).toBe(2);
  await page.goto('/staff/interview-availability/manual'); await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(form).toBeVisible();
  expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBe(true);
});
test('prelaunch links to admin-only people management and additions appear in login without granting admin rights', async ({ page }) => {
  await commonMocks(page); let admin = true; const people = [...teachers];
  await page.route('**/api/staff/session', route => route.fulfill({ json: { staff: { displayName: '確認用', role: admin ? 'admin' : 'teacher' } } }));
  await page.route('**/api/staff/login-people/manage', route => {
    if (route.request().method() === 'POST') {
      const name = route.request().postDataJSON().name;
      if (people.some(person => person.display_name === name)) return route.fulfill({ status: 409, json: { error: 'already exists' } });
      const person = { id: 'fixture-added', display_name: name }; people.push(person);
      return route.fulfill({ status: 201, json: { person } });
    }
    return route.fulfill({ json: { people } });
  });
  await page.goto('/feedback');
  await page.getByRole('navigation', { name: '業務ナビゲーション' }).getByRole('link', { name: 'ログインする人の管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登録済みの人（21名）' })).toBeVisible();
  const add = page.getByRole('form', { name: 'ログインする人を追加' });
  await add.getByLabel('表示する名前').fill('金城'); await add.getByRole('button', { name: '名前を追加' }).click();
  await expect(page.getByRole('status')).toContainText('既に登録');
  await add.getByLabel('表示する名前').fill('追加確認'); await add.getByRole('button', { name: '名前を追加' }).click();
  await expect(page.getByRole('heading', { name: '登録済みの人（22名）' })).toBeVisible();
  await expect(add).toContainText('管理者権限は付与されません');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/login-people-management-mobile.png', fullPage: true });
  admin = false; await page.reload(); await expect(page.getByRole('heading', { name: '管理者専用です' })).toBeVisible();
  await expect(add).toHaveCount(0);
  await page.goto('/'); await page.getByRole('navigation', { name: '機能の分類' }).getByRole('button', { name: '本番運用前', exact: true }).click();
  await expect(page.getByRole('link', { name: /ログインする人の管理/ })).toHaveAttribute('href', '/staff/login-people');
});
test('login design shows restart persistence and explicit logout at mobile and desktop sizes', async ({ page }) => {
  const fs = await import('node:fs'); await page.setContent(fs.readFileSync('docs/staff-login-flow.html', 'utf8'));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'ログインの動きを試す' }).click(); await expect(page.getByRole('status')).toContainText('コピー画面');
    await page.getByRole('button', { name: 'PC再起動後の表示' }).click(); await expect(page.getByRole('status')).toContainText('入力不要');
    await page.getByRole('button', { name: 'ログアウト' }).click(); await expect(page.getByRole('status')).toContainText('ログインしてください');
    expect(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `analysis_outputs/staff-login-flow-${width}.png`, fullPage: true });
  }
});
