import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('saved HTML opens interview records and information without a network connection', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: '面談記録を表示' })).toBeVisible();
  await page.getByRole('button', { name: '面談記録を表示' }).click();
  await expect(page.getByText('志望校を確認した。')).toBeVisible();
  await page.getByRole('button', { name: '情報を表示' }).click();
  await expect(page.getByText('面談連絡は保護者へ。')).toBeVisible();
  await expect(page.getByText('面談は保護者へ連絡する。')).toBeVisible();
  await expect(page.getByRole('link', { name: '一式PDFを表示・印刷' })).toHaveAttribute('href', 'staff-bundle.pdf#zoom=100&navpanes=0');
});
