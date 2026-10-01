import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialRecord, notionBlockText, recentRecordCandidates, schoolMentionsFromRecords, studentInfoCandidates } from '../src/lib/interview-material-context-core.mjs';

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

test('sibling information combines the recorded name and current school year', () => {
  const info = studentInfoCandidates({
    '兄弟姉妹１学年差': { type: 'select', select: { name: '２学年上' } },
    '兄弟姉妹１ 名前': { type: 'rich_text', rich_text: [{ plain_text: '花子' }] },
    '兄弟姉妹２学年差': { type: 'select', select: { name: '７学年下' } },
    '兄弟姉妹３学年差': { type: 'select', select: { name: '８学年上' } },
    'OB詳細（続柄：名前）': { type: 'rich_text', rich_text: [{ plain_text: '姉：花子' }] },
  }, '中2');
  assert.deepEqual(info.filter(item => item.source.startsWith('兄弟姉妹')), [
    { source: '兄弟姉妹（1人目）', value: '２学年上に花子さんがいます（現在高校1年生）' },
    { source: '兄弟姉妹（2人目）', value: '７学年下に兄弟姉妹がいます（現在小学1年生）' },
    { source: '兄弟姉妹（3人目）', value: '８学年上に兄弟姉妹がいます（現在21〜22歳程度）' },
  ]);
  assert.equal(info.find(item => item.source.startsWith('卒塾'))?.value, '姉：花子');
});

test('school mentions retain the exact record text and source', () => {
  assert.deepEqual(schoolMentionsFromRecords([{ id:'a', date:'2026-06-01', url:'https://notion.so/a',
    body:'学習状況の相談\n浦和高校が話題に出た。\n志望校：叡明も検討。\n志望校はまだ未定。' }]), [
    { date:'2026-06-01', text:'浦和高校が話題に出た。', url:'https://notion.so/a' },
    { date:'2026-06-01', text:'志望校：叡明も検討。', url:'https://notion.so/a' },
  ]);
  assert.deepEqual(schoolMentionsFromRecords([{ id:'b', title:'大宮高校について', body:'', date:'2025-12-01', url:'https://notion.so/b' }]), [
    { date:'2025-12-01', text:'大宮高校について', url:'https://notion.so/b' },
  ]);
});
