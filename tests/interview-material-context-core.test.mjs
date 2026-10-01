import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialRecord, notionBlockText, recentRecordCandidates, schoolForSelectedDestinationResults, schoolForSiblingResults, schoolMentionsFromRecords, siblingSchoolLookups, studentInfoCandidates } from '../src/lib/interview-material-context-core.mjs';

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

test('sibling school is shown only for an exact family-name match in the graduation list', () => {
  const properties = {
    '生徒氏名': { type: 'title', title: [{ plain_text: '仮名　太郎' }] },
    '兄弟姉妹１学年差': { type: 'select', select: { name: '７学年上' } },
    '兄弟姉妹１ 名前': { type: 'rich_text', rich_text: [{ plain_text: '花子' }] },
  };
  const [lookup] = siblingSchoolLookups(properties, '小4', 2026);
  assert.deepEqual(lookup, { index: 0, search: '花子', fullName: '仮名花子', graduationYear: 2025 });
  const graduate = (name, school) => ({ properties: {
    '名前': { type: 'title', title: [{ plain_text: name }] },
    '進学先': { type: 'rich_text', rich_text: [{ plain_text: school }] },
  } });
  assert.equal(schoolForSiblingResults([graduate('別姓　花子', '別の高校'), graduate('仮名　花子', 'さくら高校・普通')], lookup.fullName), 'さくら高校・普通');
  assert.equal(schoolForSiblingResults([graduate('仮名　花子', 'さくら高校'), graduate('仮名花子', 'もみじ高校')], lookup.fullName), '');
  assert.equal(schoolForSiblingResults([graduate('別姓　花子', '別の高校')], lookup.fullName), '');
  assert.deepEqual(studentInfoCandidates(properties, '小4', ['さくら高校・普通']).filter(item => item.source.startsWith('兄弟姉妹')), [
    { source: '兄弟姉妹（1人目）', value: '７学年上に花子さんがいます（現在高校2年生・進学先：さくら高校・普通）' },
  ]);
});

test('2026 entrance form supplies the selected destination school for a first-year high school sibling', () => {
  const properties = {
    '生徒氏名': { type: 'title', title: [{ plain_text: '仮名　太郎' }] },
    '兄弟姉妹１学年差': { type: 'select', select: { name: '３学年上' } },
    '兄弟姉妹１ 名前': { type: 'rich_text', rich_text: [{ plain_text: '花子' }] },
  };
  const [lookup] = siblingSchoolLookups(properties, '中1', 2026);
  assert.equal(lookup.graduationYear, 2026);
  const entrance = (name, choice, first, second, year = '2026年度') => ({ properties: {
    '生徒氏名': { type: 'title', title: [{ plain_text: name }] },
    '入試年度': { type: 'select', select: { name: year } },
    '進学先': { type: 'select', select: { name: choice } },
    '第①志望　高校名': { type: 'rich_text', rich_text: [{ plain_text: first }] },
    '第②志望　高校名': { type: 'rich_text', rich_text: [{ plain_text: second }] },
  } });
  assert.equal(schoolForSelectedDestinationResults([
    entrance('別姓　花子', '第①志望／進学', '別の高校', ''),
    entrance('仮名　花子', '第②志望／進学', 'さくら高校', 'もみじ高校'),
  ], lookup.fullName, 2026), 'もみじ高校');
  assert.equal(schoolForSelectedDestinationResults([entrance('仮名　花子', 'その他', 'さくら高校', '')], lookup.fullName, 2026), '');
  assert.equal(schoolForSelectedDestinationResults([entrance('仮名　花子', '第①志望／進学', 'さくら高校', '', '2027年度')], lookup.fullName, 2026), '');
  assert.deepEqual(studentInfoCandidates(properties, '中1', ['もみじ高校']).filter(item => item.source.startsWith('兄弟姉妹')), [
    { source: '兄弟姉妹（1人目）', value: '３学年上に花子さんがいます（現在高校1年生・進学先：もみじ高校）' },
  ]);
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
  const scoreLine='千陽さんの３月の偏差値は、５教科64.8となっており、大宮（普通科）の基準偏差値「71」までは6~7程度上げる必要があります。';
  assert.deepEqual(schoolMentionsFromRecords([{ id:'c', date:'2026-04-18', url:'https://notion.so/c',
    body:`３月の結果を確認。\n${scoreLine}` }]), [
    { date:'2026-04-18', text:scoreLine, url:'https://notion.so/c' },
  ]);
  assert.deepEqual(schoolMentionsFromRecords([{ id:'d', body:'本人の偏差値は前回より上昇した。' }]), []);
});
