import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderOfflineSchoolLibrary, validateHokushinCatalog } from '../src/lib/hokushin-school-library.mjs';

const option = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--catalog') || !process.argv.includes('--output')) throw Error('--catalog and --output are required');
const source = path.resolve(option('--catalog'));
const output = path.resolve(option('--output'));
const catalog = validateHokushinCatalog(JSON.parse(await fs.readFile(source, 'utf8')));
const template = await fs.readFile(new URL('../public/hokushin-school-library-template.html', import.meta.url), 'utf8');
const capturedAt = new Date().toISOString();
const html = renderOfflineSchoolLibrary(template, catalog.items, capturedAt);
const correctPdf = (data, item) => data.length === item.bytes && data.subarray(0, 5).toString() === '%PDF-'
  && crypto.createHash('sha256').update(data).digest('hex') === item.id;
// Verify all inputs before creating the standalone library.
for (const item of catalog.items) {
  if (!correctPdf(await fs.readFile(path.join(path.dirname(source), 'pdf', `${item.id}.pdf`)), item))
    throw Error(`Invalid school PDF: ${item.school}`);
}
await fs.mkdir(path.join(output, 'pdf'), { recursive: true });
let reused = 0;
for (const item of catalog.items) {
  const file = path.join(output, 'pdf', `${item.id}.pdf`);
  const previous = await fs.readFile(file).catch(() => null);
  if (previous && correctPdf(previous, item)) { reused++; continue; }
  const data = await fs.readFile(path.join(path.dirname(source), 'pdf', `${item.id}.pdf`));
  const partial = `${file}.partial`;
  await fs.writeFile(partial, data);
  await fs.rename(partial, file);
}
await fs.writeFile(path.join(output, '保存情報.json'), JSON.stringify({ kind: 'hokushin-school-library', capturedAt,
  items: catalog.items.map(({ id, school, reading, category, year, bytes }) => ({ id, school, reading, category, year, bytes })) }), 'utf8');
await fs.writeFile(path.join(output, '使い方.txt'), '「北辰基礎資料.html」を開くと、学校名で検索して全学校・学科の資料を閲覧できます。\n生徒の面談資料とは独立した共通資料です。\n別のPCへ移すときは、pdfフォルダを含む「北辰基礎資料」フォルダを丸ごとコピーしてください。\n', 'utf8');
await fs.writeFile(path.join(output, '北辰基礎資料.html'), html, 'utf8');
console.log(JSON.stringify({ complete: true, count: catalog.items.length, reused, bytes: catalog.items.reduce((sum, item) => sum + item.bytes, 0), output }));
