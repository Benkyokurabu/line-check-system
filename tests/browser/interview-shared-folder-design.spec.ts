import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('shared folder design exposes HTML saving directly and fits a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(resolve('docs/interview-shared-folder-save-design-20261007.html')).href);
  await page.getByRole('button', { name: /共有フォルダに保存/ }).click();
  await expect(page.getByRole('status')).toContainText('先生別フォルダを作成 → HTML・PDF・面談記録・生徒情報を保存');
  await expect(page.locator('pre').last()).toContainText('面談資料.html ← ダブルクリックして閲覧');
  await page.getByRole('button', { name: /画面で見る/ }).click();
  await expect(page.getByRole('heading', { name: '画面で見る', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成した資料に戻る' }).click();
  await expect(page.getByRole('heading', { name: '画面で見る', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'analysis_outputs/interview-shared-folder-save-design-mobile.png', fullPage: true });
});
