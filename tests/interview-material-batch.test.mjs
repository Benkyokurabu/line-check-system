import test from 'node:test';
import assert from 'node:assert/strict';
import { latestMaterialBatchAnswer, materialBatchAppointments, materialBatchMissing, sameMaterialAppointment } from '../src/lib/interview-material-batch.mjs';
import { resolveMaterialAppointments } from '../src/lib/bensuke-material-ai.mjs';

test('selects only the requested Notion day and actual appointment teacher, in time order', () => {
  const first = { id: 'a', name: 'A', teacherId: 'teacher-1', date: '2026-10-05', start: '17:00', source: 'notion-bensuke' };
  const second = { ...first, id: 'b', start: '18:00' };
  assert.deepEqual(materialBatchAppointments([second, { ...first, id: 'other', teacherId: 'teacher-2' },
    { ...first, id: 'tomorrow', date: '2026-10-06' }, first], '2026-10-05', 'teacher-1'), [first, second]);
  assert.throws(() => materialBatchAppointments([first, first], first.date, first.teacherId));
  assert.throws(() => materialBatchAppointments([{ ...first, source: 'bookings' }], first.date, first.teacherId));
  assert.throws(() => materialBatchAppointments([], first.date, ''));
});

test('latest survey compares instants and does not mutate or silently choose ambiguous responses', () => {
  const old = { id: 'old', date: '2026-10-05T08:00:00Z' };
  const latest = { id: 'latest', date: '2026-10-05T18:00:00+09:00' };
  const rows = [old, latest];
  assert.equal(latestMaterialBatchAnswer(rows), latest);
  assert.deepEqual(rows, [old, latest]);
  assert.equal(latestMaterialBatchAnswer([]), null);
  assert.equal(latestMaterialBatchAnswer([old]), old);
  assert.throws(() => latestMaterialBatchAnswer([old, { id: 'ambiguous', date: '2026-10-05T17:00:00+09:00' }]));
  assert.throws(() => latestMaterialBatchAnswer([old, { id: 'undated', date: '' }]));
});

test('identity, teacher, time and Notion edit revision must stay identical before a batch', () => {
  const row = { id: 'notion', number: '2022005', name: 'A', grade: '小5', teacher: '鈴木', teacherId: 'teacher-1',
    date: '2026-10-05', start: '17:00', editedAt: '2026-10-05T01:00:00Z', source: 'notion-bensuke' };
  assert.equal(sameMaterialAppointment(row, { ...row }), true);
  for (const field of Object.keys(row)) assert.equal(sameMaterialAppointment(row, { ...row, [field]: 'changed' }), false);
});

test('reports unavailable personal documents by grade and retains generation failures', () => {
  const preview = { hokushin: { found: false, message: '本人の成績票なし' }, vmogi: { found: false }, termReport: { found: true } };
  assert.deepEqual(materialBatchMissing(preview, '中3', ['学校資料なし', '学校資料なし']),
    ['学校資料なし', '北辰の個人成績票：本人の成績票なし', 'Vもぎ：該当資料なし']);
  assert.deepEqual(materialBatchMissing(preview, '小5'), []);
  assert.deepEqual(materialBatchMissing({ termReport: { found: false } }, '小5'), ['成績通知の個人成績表：該当資料なし']);
});

test('teacher filtering retains grounded review metadata without authorizing uncertain students', () => {
  const directory = [{ id: 'teacher-1', name: '工藤' }, { id: 'teacher-2', name: '鈴木' }];
  const row = { id: 'uncertain', title: '本人未特定 工藤先生', fields: [], teacherIds: [],
    date: { start: '2026-10-05T17:00:00+09:00' }, url: 'https://notion.so/uncertain' };
  const decision = { id: row.id, kind: 'review', studentName: '', studentNumber: '', teacherName: '工藤', reason: '本人未特定' };
  const resolve = (changes = {}) => resolveMaterialAppointments({ rows: [row], decisions: [decision], students: [], directory, date: '2026-10-05', ...changes });
  assert.deepEqual(resolve().review[0].teacherIds, ['teacher-1']);
  assert.deepEqual(resolve({ rows: [{ ...row, teacherIds: ['teacher-2'] }] }).review[0].teacherIds, ['teacher-2']);
  assert.deepEqual(resolve({ decisions: [{ ...decision, teacherName: '鈴木' }] }).review[0].teacherIds, []);
  assert.deepEqual(resolve().appointments, []);
});
