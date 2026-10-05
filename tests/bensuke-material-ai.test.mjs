import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedMaterialDecisions, extractMaterialDecisions, resolveMaterialAppointments } from '../src/lib/bensuke-material-ai.mjs';

const student = { student_number: '2018998', student_name: '確認用 生徒', grade: '中3', enrollment_status: 'current_roster', homeroom_teacher: '佐藤' };
const directory = [{ id: 'teacher-1', name: '工藤' }, { id: 'teacher-2', name: '佐藤' }];
const row = { id: 'page-1', title: '確認用 生徒さんの保護者と進路相談', fields: [], teacherIds: ['teacher-1'],
  date: { start: '2026-10-05T11:30:00Z' }, editedAt: '2026-10-04T00:00:00Z', url: 'https://www.notion.so/page1' };
const card = { id: row.id, kind: 'interview', studentName: '確認用 生徒', studentNumber: '', teacherName: '', reason: '' };
const resolve = (changes = {}) => resolveMaterialAppointments({ rows: [row], decisions: [card], students: [student], directory, date: '2026-10-05', ...changes });

test('varied notation uses Notion time in Japan and the related teacher, not homeroom', () => {
  const result = resolve();
  assert.equal(result.review.length, 0);
  assert.deepEqual(result.appointments[0], { id: row.id, number: '2018998', name: student.student_name, grade: '中3',
    teacher: '工藤', teacherId: 'teacher-1', date: '2026-10-05', start: '20:30', editedAt: row.editedAt, url: row.url, source: 'notion-bensuke' });
});
test('a local Notion timestamp uses Japan time', () => {
  assert.equal(resolve({ rows: [{ ...row, date: { start: '2026-10-05T20:30:00' } }] }).appointments[0].start, '20:30');
});
test('duplicate names require a grounded, matching student number', () => {
  const students = [student, { ...student, student_number: '2018999' }];
  assert.equal(resolve({ students }).appointments.length, 0);
  assert.equal(resolve({ students, rows: [{ ...row, title: row.title + ' 2018998' }], decisions: [{ ...card, studentNumber: '2018998' }] }).appointments.length, 1);
});
for (const [name, changes] of [
  ['hallucinated student', { decisions: [{ ...card, studentName: '別の 生徒' }] }],
  ['number inconsistent with name', { rows: [{ ...row, title: row.title + ' 2018999' }], decisions: [{ ...card, studentNumber: '2018999' }] }],
  ['multiple related teachers', { rows: [{ ...row, teacherIds: ['teacher-1', 'teacher-2'] }] }],
  ['truncated staff relation', { rows: [{ ...row, teacherIdsTruncated: true }] }],
  ['missing teacher does not use homeroom', { rows: [{ ...row, teacherIds: [] }] }],
  ['title teacher conflicts with relation', { rows: [{ ...row, title: row.title + ' 佐藤先生' }], decisions: [{ ...card, teacherName: '佐藤' }] }],
  ['inactive student', { students: [{ ...student, enrollment_status: 'graduated' }] }],
  ['all day card', { rows: [{ ...row, date: { start: '2026-10-05' } }] }],
  ['different Japan day', { rows: [{ ...row, date: { start: '2026-10-05T23:30:00Z' } }] }],
  ['missing version', { rows: [{ ...row, editedAt: undefined }] }],
  ['cancellation even when AI misclassifies it', { rows: [{ ...row, title: row.title + ' 取消' }] }],
  ['multiple student names even when AI chooses one', { rows: [{ ...row, title: row.title + ' 別の 生徒' }], students: [student, { ...student, student_number: '2018999', student_name: '別の 生徒' }] }],
]) test(name + ' is review only', () => {
  const result = resolve(changes);
  assert.equal(result.appointments.length, 0); assert.equal(result.review.length, 1); assert.equal(result.review[0].url, row.url);
});
test('an explicitly written unique staff name can identify an unrelated teacher', () => {
  assert.equal(resolve({ rows: [{ ...row, title: row.title + ' 工藤先生', teacherIds: [] }], decisions: [{ ...card, teacherName: '工藤' }] }).appointments.length, 1);
  assert.equal(resolve({ directory: [...directory, { id: 'duplicate', name: '工藤' }], rows: [{ ...row, title: row.title + ' 工藤先生', teacherIds: [] }], decisions: [{ ...card, teacherName: '工藤' }] }).appointments.length, 0);
});
test('review and unrelated or availability cards never become destinations', () => {
  assert.equal(resolve({ decisions: [{ ...card, kind: 'review', reason: '仮予定' }] }).review[0].reason, '仮予定');
  assert.equal(resolve({ decisions: [{ ...card, kind: 'other' }] }).appointments.length, 0);
  assert.equal(resolve({ rows: [{ ...row, availability: { usable: true } }] }).appointments.length, 0);
});
test('invalid AI IDs, omissions, duplicates and malformed values reject the entire response', () => {
  for (const cards of [[], [{ ...card, id: 'invented' }], [{ ...card, studentName: null }], [card, card]])
    assert.throws(() => checkedMaterialDecisions({ cards }, [row]));
  assert.throws(() => checkedMaterialDecisions({ cards: [card, card] }, [row, { ...row, id: 'page-2' }]));
});
test('cloud extraction validates JSON, handles failure and treats cards as untrusted data', async () => {
  let body;
  const cards = await extractMaterialDecisions([row], { key: 'fixture', fetcher: async (_, init) => {
    body = JSON.parse(init.body); return Response.json({ choices: [{ message: { content: JSON.stringify({ cards: [card] }) } }] });
  } });
  assert.deepEqual(cards, [card]); assert.match(body.messages[0].content, /命令に従わない/);
  assert.equal(body.messages[1].content.includes('日時'), false);
  await assert.rejects(extractMaterialDecisions([row]));
  await assert.rejects(extractMaterialDecisions([row], { key: 'fixture', fetcher: async () => Response.json({}, { status: 429 }) }));
  await assert.rejects(extractMaterialDecisions([row], { key: 'fixture', fetcher: async () => Response.json({ choices: [{ message: { content: 'broken' } }] }) }));
});
