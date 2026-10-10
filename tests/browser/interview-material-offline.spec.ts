import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

for (const width of [390, 1365]) test(`all-school contents works offline at ${width}px and preserves the original materials`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const template = await readFile('public/interview-material-offline-template.html', 'utf8');
  const html = template.replace('__ITEMS_JSON__', JSON.stringify([{ label: '指導簿', kind: '指導簿' }]))
    .replace('__STUDENT_NAME_JSON__', JSON.stringify('確認用生徒'))
    .replace('__CONTEXT_JSON__', JSON.stringify({ records: [], info: [], summary: { status: 'empty', items: [] }, schoolLibrary: [
      { id: 'a', school: '川口（普通）', reading: 'か川口', category: '公立', year: 2027, file: 'hokushin-a.pdf' },
      { id: 'b', school: '叡明', reading: 'え叡明', category: '私立', year: 2026, file: 'hokushin-b.pdf' },
    ] }));
  await page.route('**/*', route => route.abort());
  await page.setContent(html);
  await page.getByRole('button', { name: '北辰基礎資料の目次（全2件）' }).click();
  await expect(page.getByRole('heading', { name: '北辰基礎資料の目次' })).toBeVisible();
  await page.getByRole('searchbox', { name: '学校名で検索' }).fill('川口');
  await expect(page.getByText('1件 / 全2件')).toBeVisible();
  await page.getByRole('button', { name: '川口（普通）の北辰基礎資料を表示' }).click();
  await expect(page.locator('#current-source')).toHaveAttribute('href', 'hokushin-a.pdf#zoom=100&navpanes=0');
  await expect(page.locator('iframe.active')).toHaveAttribute('src', 'hokushin-a.pdf#zoom=100&navpanes=0');
  await page.getByRole('button', { name: '北辰基礎資料の目次', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '学校名で検索' })).toHaveValue('川口');
  await page.getByRole('searchbox', { name: '学校名で検索' }).fill('');
  await page.getByRole('combobox', { name: '学校の種類' }).selectOption('私立');
  await expect(page.getByRole('button', { name: '叡明の北辰基礎資料を表示' })).toContainText('2026年度');
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: `analysis_outputs/hokushin-school-library-offline-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '叡明の北辰基礎資料を表示' }).click();
  await expect(page.locator('iframe.active')).toHaveAttribute('src', 'hokushin-b.pdf#zoom=100&navpanes=0');
  await page.getByRole('button', { name: '指導簿を表示' }).click();
  await expect(page.locator('iframe.active')).toHaveAttribute('src', 'material-0.pdf#zoom=100&navpanes=0');
  await page.getByRole('button', { name: '← 表紙に戻る' }).click();
  await expect(page.getByRole('button', { name: '資料を画面で見る' })).toBeFocused();
});

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

test('saved student HTML links directly to the shared all-school HTML from every save layout', async ({ browser }) => {
  const root = await mkdtemp(join(tmpdir(), 'bentan-shared-hokushin-'));
  try {
    const template = await readFile('public/interview-material-offline-template.html', 'utf8');
    const target = 'file://ts3210/' + 'benko/03 教務部/015 各面談行事／文化会館も含む/07 中３秋冬面談資料/北辰基礎資料/北辰基礎資料.html'
      .split('/').map(encodeURIComponent).join('/');
    const rendered = template.replace('__ITEMS_JSON__', JSON.stringify([{ label: '指導簿', kind: '指導簿' }]))
      .replace('__STUDENT_NAME_JSON__', '"確認用生徒"')
      .replace('__CONTEXT_JSON__', JSON.stringify({ records: [], info: [], summary: { status: 'empty', items: [] } }));
    const layouts = [
      { parts: ['金城先生', '生徒'], base: '' },
      { parts: ['個別保存', '生徒'], base: '' },
      { parts: ['鈴木先生', '中3', '生徒'], base: '' },
      { parts: ['工藤先生', '生徒'], base: '_auto_versions/0123456789abcdef/' },
      { parts: ['鈴木先生', '中3', '生徒'], base: '_auto_versions/0123456789abcdef/' },
    ];
    for (const { parts, base } of layouts) {
      const student = join(root, '98面談資料', ...parts);
      await mkdir(student, { recursive: true });
      const file = join(student, '面談資料.html');
      const html = base ? rendered.replace('<head>', `<head><base href="${base}">`) : rendered;
      await writeFile(file, html);
      const page = await browser.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.getByRole('button', { name: '資料を画面で見る' }).click();
      const link = page.getByRole('link', { name: '【全】北辰基礎資料' });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('href', target);
      expect(await link.evaluate(element => (element as HTMLAnchorElement).href)).toBe(target);
      const material = page.locator('#saved-files a');
      await expect(material).toHaveAttribute('href', 'material-0.pdf');
      expect(await material.evaluate(element => (element as HTMLAnchorElement).href))
        .toBe(new URL(`${base}material-0.pdf`, pathToFileURL(file)).href);
      await page.getByRole('button', { name: '面談記録を表示' }).click();
      await expect(page.getByText('面談記録は見つかりませんでした。')).toBeVisible();
      await page.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
