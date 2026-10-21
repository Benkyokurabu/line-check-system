// Historical manual implementation, not an application feature.
// Reading local evidence is allowed; network replay requires an explicit CLI flag.
if (!process.argv.includes('--replay-read-only')) {
  console.log('Saved 2026-10-21 manual implementation. See docs/individual-room-availability-20261021.md. Use --replay-read-only only to inspect authorized local/Notion evidence.');
  process.exit(0);
}
if (process.argv.includes('apply')) throw new Error('This run already completed. Publishing is disabled in the archived implementation.');
process.argv = process.argv.filter(value => value !== '--replay-read-only');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { parseScheduleWorkbook } from '../../src/lib/schedule-excel.mjs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const tokenPath = path.join(os.homedir(), '.codex', 'notion_token.txt');
const token = env.NOTION_TOKEN || env.NOTION_API_KEY || (fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '');
if (!token) throw new Error('Notion token missing');
const out = '.private/kobetsu-20261021';
fs.mkdirSync(out, { recursive: true });
const sourceId = '19ef0120-80a7-80c4-a965-000b104ea319';
const pages = [];
let cursor;
do {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${sourceId}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2025-09-03' },
    body: JSON.stringify({ page_size: 100, start_cursor: cursor, filter: { and: [
      { property: '日時', date: { on_or_after: '2026-10-01T00:00:00+09:00' } },
      { property: '日時', date: { before: '2026-12-01T00:00:00+09:00' } },
    ] }, sorts: [{ property: '日時', direction: 'ascending' }] }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${body.message}`);
  pages.push(...body.results);
  cursor = body.has_more ? body.next_cursor : undefined;
  if (pages.length > 10000) throw new Error('Too many schedule pages');
} while (cursor);
fs.writeFileSync(`${out}/notion-pages.json`, JSON.stringify(pages, null, 2));
const rows = pages.map(page => ({ id: page.id, url: page.url, edited: page.last_edited_time,
  title: page.properties['名前']?.title.map(x => x.plain_text ?? x.text?.content ?? '').join('') ?? '',
  date: page.properties['日時']?.date, tags: page.properties['内容']?.multi_select.map(x => x.name) ?? [],
  room: page.properties['教室']?.select?.name ?? '', campus: page.properties['校舎']?.multi_select.map(x => x.name) ?? [],
  teachers: page.properties['担当者']?.relation.map(x => x.id) ?? [],
  note: page.properties['備考']?.rich_text.map(x => x.plain_text ?? x.text?.content ?? '').join('') ?? '',
}));
fs.writeFileSync(`${out}/notion-rows.json`, JSON.stringify(rows, null, 2));
const slots = rows.filter(x => x.tags.includes('個別使用可能'));
const counts = values => Object.fromEntries([...new Set(values)].map(v => [v, values.filter(x => x === v).length]));
console.log(JSON.stringify({ fetched: rows.length, available: slots.length, availabilityMonths: counts(slots.map(x => x.date.start.slice(0, 7))),
  availabilityTitles: counts(slots.map(x => x.title)), availabilityRooms: counts(slots.map(x => x.room)),
  availabilityTags: counts(slots.map(x => x.tags.join(','))), examples: slots.slice(0, 6), latestExamples: slots.slice(-6) }, null, 2));
for (const month of ['2026-10', '2026-11']) {
  const source = path.join(os.homedir(), 'OneDrive', 'デスクトップ', '【完成版】授業日誌システム', `${month.slice(0,4)}年${Number(month.slice(5))}月スケジュール.xlsm`);
  const buffer = fs.readFileSync(source);
  fs.writeFileSync(`${out}/${month}.xlsm`, buffer);
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true, bookVBA: false });
  const lessons = parseScheduleWorkbook(buffer, month);
  fs.writeFileSync(`${out}/lessons-${month}.json`, JSON.stringify(lessons, null, 2));
  const sheetName = wb.SheetNames.find(x => x.includes('本校') && x.includes('教務'));
  const sheet = wb.Sheets[sheetName];
  const cells = [];
  for (let r = 0; r < 58; r++) {
    const row = [];
    for (let c = 0; c < 34; c++) {
      const a = XLSX.utils.encode_cell({r,c});
      if (sheet[a]?.v != null && String(sheet[a].v).trim()) row.push([a, sheet[a].v]);
    }
    if (row.length) cells.push(row);
  }
  fs.writeFileSync(`${out}/grid-${month}.json`, JSON.stringify({source,sheetName,cells,merges: sheet['!merges']}, null, 2));
  console.log(JSON.stringify({ month, source, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), sheets: wb.SheetNames,
    honLessons: lessons.filter(x=>x.campus==='hon').length, sample: cells.slice(0, 13), last: cells.slice(-5) }, null, 2));
}
