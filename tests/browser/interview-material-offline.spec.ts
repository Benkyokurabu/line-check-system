import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('saved HTML opens interview records and information without a network connection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const template = await readFile('public/interview-material-offline-template.html', 'utf8');
  const html = template.replace('__ITEMS_JSON__', JSON.stringify([{ label: '指導簿', kind: '指導簿' }]))
    .replace('__STUDENT_NAME_JSON__', JSON.stringify('確認用生徒'))
    .replace('__CONTEXT_JSON__', JSON.stringify({
      records: [{ id: 'record', date: '2026-05-23', title: '進路相談', body: '志望校を確認した。', url: 'https://notion.so/record' }],
      info: [{ source: '連絡先　備考', value: '面談は保護者へ連絡する。' }],
      summary: { status: 'completed', items: [{ source: '連絡先　備考', note: '面談連絡は保護者へ。', original: '面談は保護者へ連絡する。' }] },
      studentUrl: 'https://notion.so/student', source: 'notion',
    }));
  await page.route('**/*', route => route.abort());
  await page.setContent(html);
  await expect(page.getByRole('link', { name: '指導簿' })).toHaveAttribute('href', 'material-0.pdf');
  await expect(page.getByRole('button', { name: '資料を画面で見る' })).toBeVisible();
  await page.getByRole('button', { name: '資料を画面で見る' }).click();
  const back = page.getByRole('button', { name: '← 表紙に戻る' });
  await expect(back).toBeVisible();
  const backBounds = await back.boundingBox();
  expect(backBounds).not.toBeNull();
  expect(backBounds!.x).toBeGreaterThanOrEqual(0);
  expect(backBounds!.x + backBounds!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: '面談記録を表示' })).toBeVisible();
  await page.getByRole('button', { name: '面談記録を表示' }).click();
  await expect(page.getByText('志望校を確認した。')).toBeVisible();
  await page.getByRole('button', { name: '情報を表示' }).click();
  await expect(page.getByText('面談連絡は保護者へ。')).toBeVisible();
  await expect(page.getByText('面談は保護者へ連絡する。')).toBeVisible();
  await expect(page.getByRole('link', { name: '一式PDFを表示・印刷' })).toHaveAttribute('href', 'staff-bundle.pdf#zoom=100&navpanes=0');
  await back.click();
  await expect(page.getByRole('button', { name: '資料を画面で見る' })).toBeFocused();
  await page.getByRole('button', { name: '資料を画面で見る' }).click();
  await expect(back).toBeVisible();
});

test('downloaded HTML opens from a local folder and links to saved text', async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), 'bentan-material-offline-'));
  try {
    const template = await readFile('public/interview-material-offline-template.html', 'utf8');
    const html = template.replace('__ITEMS_JSON__', JSON.stringify([{ label: '指導簿', kind: '指導簿' }]))
      .replace('__STUDENT_NAME_JSON__', JSON.stringify('確認用生徒'))
      .replace('__CONTEXT_JSON__', JSON.stringify({
        records: [{ id: 'record', date: '2026-05-23', title: '進路相談', body: '志望校を確認した。', url: 'https://notion.so/record' }],
        info: [], summary: { status: 'completed', items: [] }, studentUrl: '', source: 'notion',
      }));
    await writeFile(join(folder, '面談資料.html'), html, 'utf8');
    await writeFile(join(folder, '面談記録.txt'), '志望校を確認した。', 'utf8');
    await page.goto(pathToFileURL(join(folder, '面談資料.html')).href);
    await expect(page.locator('#student-title')).toHaveText('確認用生徒の面談資料');
    await expect(page.locator('#saved-files a')).toHaveAttribute('href', 'material-0.pdf');
    await page.locator('#reopen').click();
    await page.getByRole('button', { name: '面談記録を表示' }).click();
    await expect(page.getByText('志望校を確認した。')).toBeVisible();
    await page.locator('#close').click();
    await expect(page.locator('a[href="面談記録.txt"]')).toBeVisible();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
