import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyMaterialSourceHash, futureMaterialAppointment, tokyoMaterialNow, verifiedDailyAppointment } from '../src/lib/interview-material-daily-core.mjs';

const appointment = { id: 'appointment', number: '2018998', name: '確認用 生徒', grade: '小6', teacher: '確認用',
  teacherId: 'teacher', date: '2030-01-02', start: '21:30', editedAt: '2030-01-01T00:00:00Z', source: 'notion-bensuke' };
const payload = { number: '2018998', name: '確認用 生徒', grade: '小6', schools: [], survey: { id: 'answer', fields: [] } };
const context = { capturedAt: '2030-01-01', records: [{ date: '2029-12-01', body: '原文' }], info: [{ value: '希望' }], summary: { status: 'prepared', sourceHash: 'source', items: [] } };

test('日本時間で面談時刻を過ぎた予定と判定できない予定を除外', () => {
  assert.deepEqual(tokyoMaterialNow(new Date('2030-01-02T12:29:00Z')), { date: '2030-01-02', time: '21:29' });
  assert.equal(futureMaterialAppointment(appointment, new Date('2030-01-02T12:29:00Z')), true);
  assert.equal(futureMaterialAppointment(appointment, new Date('2030-01-02T12:30:00Z')), false);
  assert.equal(futureMaterialAppointment({ ...appointment, source: 'guessed' }, new Date('2030-01-01')), false);
});
test('予定の変更・取消・開始時刻超過は保存前に拒否', () => {
  const now = new Date('2030-01-01');
  assert.deepEqual(verifiedDailyAppointment(appointment, [appointment], now), appointment);
  for (const changed of [[], [{ ...appointment, teacherId: 'other' }], [{ ...appointment, number: '2018999' }], [{ ...appointment, editedAt: 'new' }]])
    assert.throws(() => verifiedDailyAppointment(appointment, changed, now), /変更・取消/);
  assert.throws(() => verifiedDailyAppointment(appointment, [appointment], new Date('2030-01-03')), /時刻を過ぎ/);
});
test('取得時刻と任意AIの完成状態は本人の原文指紋を変えない', () => {
  const original = dailyMaterialSourceHash(appointment, payload, context);
  assert.equal(dailyMaterialSourceHash(appointment, payload, { ...context, capturedAt: 'later', summary: { ...context.summary,
    status: 'completed', items: [{ note: '確認点', source: '面談原文' }] } }), original);
  assert.notEqual(dailyMaterialSourceHash(appointment, payload, { ...context, info: [{ value: '新しい希望' }] }), original);
  assert.notEqual(dailyMaterialSourceHash(appointment, { ...payload, survey: { id: 'new', fields: [] } }, context), original);
  assert.notEqual(dailyMaterialSourceHash({ ...appointment, start: '22:00' }, payload, context), original);
});
