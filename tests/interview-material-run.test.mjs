import test from 'node:test';
import assert from 'node:assert/strict';
import { materialRunDates, materialRunJobs, materialRunReviews } from '../src/lib/interview-material-run-core.mjs';
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

test('review details preserve the source title, Japan time, reason and staff, including unknown identities', () => {
  const planned=[{day:{date:'2030-01-02',rows:[{id:'a',date:{start:'2030-01-01T15:30:00Z'}},{id:'b',date:{start:'2030-01-02'}}]},
    directory:[{id:'teacher-a',name:'確認用先生'},{id:'teacher-b',name:'別先生'}],
    review:[{id:'a',title:'小６ 確認用の姓',reason:'フルネーム未確認',url:'https://www.notion.so/a',teacherIds:['teacher-a']},
      {id:'b',title:'日時未定の面談',reason:'日時未確認',url:'https://www.notion.so/b',teacherIds:[]},
      {id:'c',title:'別担当の予定',reason:'氏名未確認',url:'https://www.notion.so/c',teacherIds:['teacher-b']}]}];
  const list=materialRunReviews(planned,'teacher-a');
  assert.equal(list.length,2);
  assert.deepEqual(list[0],{id:'a',title:'小６ 確認用の姓',reason:'フルネーム未確認',url:'https://www.notion.so/a',date:'2030-01-02',start:'00:30',teachers:['確認用']});
  assert.equal(list[1].start,''); assert.deepEqual(list[1].teachers,[]);
  assert.equal(materialRunReviews(planned).length,3);
});
