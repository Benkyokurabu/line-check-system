import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialRecord, notionBlockText, recentRecordCandidates, studentInfoCandidates } from '../src/lib/interview-material-context-core.mjs';

test('student context includes notes and avoids contact numbers', () => {
  const fields = studentInfoCandidates({
    '他の習い事': { type: 'rich_text', rich_text: [{ plain_text: '毎週火曜に水泳' }] },
    '連絡先　備考': { type: 'rich_text', rich_text: [{ plain_text: '面談時は母へ連絡' }] },
    '母携帯電話': { type: 'phone_number', phone_number: '09000000000' },
    '住所（全角）': { type: 'rich_text', rich_text: [{ plain_text: '住所' }] },
  });
  assert.deepEqual(fields, [
    { source: '連絡先　備考', value: '面談時は母へ連絡' },
    { source: '他の習い事', value: '毎週火曜に水泳' },
  ]);
});

test('interview records read the written page body, including code blocks', () => {
  assert.equal(notionBlockText({ type: 'code', code: { rich_text: [{ plain_text: '本人の希望を確認した。' }] } }), '本人の希望を確認した。');
  const record = materialRecord({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://www.notion.so/example',
    properties: { '面談内容': { type: 'title', title: [{ plain_text: '進路相談' }] }, '面談日': { date: { start: '2026-05-23' } } } },
    '本人の希望を確認した。');
  assert.equal(record.title, '進路相談');
  assert.equal(record.date, '2026-05-23');
  assert.equal(record.body, '本人の希望を確認した。');
});

test('recent records keep their entire text and become cited AI sources', () => {
  const longBody = '前回の約束。'.repeat(2500);
  const record = materialRecord({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    properties: { '面談内容': { type: 'title', title: [{ plain_text: '進路相談' }] }, '面談日': { date: { start: '2026-05-23' } } } }, longBody);
  assert.equal(record.body, longBody);
  assert.deepEqual(recentRecordCandidates([record]), [{ source: '過去の面談記録1（2026-05-23・進路相談）', value: longBody }]);
});
