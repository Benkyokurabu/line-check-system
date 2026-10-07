import test from 'node:test';
import assert from 'node:assert/strict';
import { materialRunDates, materialRunJobs } from '../src/lib/interview-material-run-core.mjs';
import { teacherRouteAllowed } from '../src/lib/staff-teacher-route-access.mjs';
test('manual range is explicit, inclusive and limited; past and invalid dates rejected', () => {
  assert.equal(materialRunDates('2030-01-01', '2030-01-08', '2030-01-01').length, 8);
  for (const [from, to] of [['2029-12-31','2030-01-01'],['2030-01-01','2030-01-09'],['2030-02-30','2030-02-30'],['2030-02-02','2030-02-02']])
    assert.throws(() => materialRunDates(from,to,'2030-01-01'));
});
test('queue replay is idempotent and teacher filter cannot include another teacher', () => {
  const rows = [{ id: 'appointment', number: '2018998', teacherId: 'a' }, { id: 'other', number: '2018999', teacherId: 'b' }];
  const options = { runId: 'run', staffCode: 'teacher', teacherId: 'a', from: '2030-01-01', to: '2030-01-08' };
  const first = materialRunJobs(rows, options);
  assert.deepEqual(materialRunJobs(rows, options), first);
  assert.equal(first.length, 1);
  assert.equal(first[0].payload.autoDaily.manual, true);
  assert.notEqual(materialRunJobs(rows, { ...options, runId: 'retry' })[0].daily_key, first[0].daily_key);
});
test('usual teacher login can submit and read manual material requests', () => {
  assert.equal(teacherRouteAllowed('/api/staff/interview-material-run'), true);
  assert.equal(teacherRouteAllowed('/api/staff/interview-material-daily'), true);
  assert.equal(teacherRouteAllowed('/api/material-worker'), false);
});
