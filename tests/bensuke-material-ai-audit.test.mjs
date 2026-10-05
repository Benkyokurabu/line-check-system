import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedMaterialDecisions, resolveMaterialAppointments } from '../src/lib/bensuke-material-ai.mjs';
import { teacherRouteAllowed } from '../src/lib/staff-teacher-route-access.mjs';

const student = { student_number: '2018998', student_name: '確認用 生徒', grade: '中3', enrollment_status: 'current_roster' };
const staff = { id: '11111111-1111-4111-8111-111111111111', name: '工藤' };
const row = { id: 'card-1', title: '教育相談 確認用 生徒', fields: [], teacherIds: [staff.id],
  date: { start: '2026-10-05T11:30:00Z' }, editedAt: '2026-10-05T01:00:00Z', url: 'https://www.notion.so/card1' };
const decision = { id: row.id, kind: 'interview', studentName: '確認用 生徒', studentNumber: '', teacherName: '', reason: '' };
function resolve(change = {}, candidate = {}, students = [student], directory = [staff]) {
  return resolveMaterialAppointments({ rows: [{ ...row, ...change }], decisions: [{ ...decision, ...candidate }],
    students, directory, date: '2026-10-05' });
}

test('existing teacher login can read material appointments while administrative routes stay denied', () => {
  assert.equal(teacherRouteAllowed('/api/staff/interview-material-appointments'), true);
  assert.equal(teacherRouteAllowed('/api/admin/contacts'), false);
  assert.equal(teacherRouteAllowed('/api/staff/interviews'), false);
});

test('Notion UTC time converts to Japan and relation selects the teacher', () => {
  const result = resolve();
  assert.equal(result.appointments.length, 1);
  assert.equal(result.appointments[0].start, '20:30');
  assert.equal(result.appointments[0].teacherId, staff.id);
  assert.equal(result.appointments[0].editedAt, row.editedAt);
});

test('roster duplicates and nonexistent names cannot authorize a destination', () => {
  assert.equal(resolve({}, {}, [student, { ...student, student_number: '2018997' }]).appointments.length, 0);
  assert.equal(resolve({}, { studentName: '別人' }).appointments.length, 0);
  assert.equal(resolve({}, {}, [{ ...student, enrollment_status: 'graduated' }]).appointments.length, 0);
});

test('unknown, multiple, truncated and conflicting teachers require review', () => {
  for (const change of [{ teacherIds: [] }, { teacherIds: ['unknown'] },
    { teacherIds: [staff.id, 'another'] }, { teacherIdsTruncated: true }]) {
    assert.equal(resolve(change).appointments.length, 0);
    assert.equal(resolve(change).review.length, 1);
  }
  assert.equal(resolve({ title: `${row.title} 鈴木先生` }, { teacherName: '鈴木' }, [student],
    [staff, { id: 'other', name: '鈴木' }]).appointments.length, 0);
});

test('date-only, changed Japanese day and missing Notion revision require review', () => {
  for (const change of [{ date: { start: '2026-10-05' } },
    { date: { start: '2026-10-05T20:30:00Z' } }, { editedAt: '' }]) {
    assert.equal(resolve(change).appointments.length, 0);
  }
});

test('AI IDs must cover every source exactly once and inventing evidence is rejected', () => {
  assert.throws(() => checkedMaterialDecisions({ cards: [{ ...decision, id: 'invented' }] }, [row]));
  assert.throws(() => checkedMaterialDecisions({ cards: [decision, decision] }, [row]));
  assert.throws(() => checkedMaterialDecisions({ cards: [] }, [row]));
  assert.equal(resolve({}, { studentNumber: student.student_number }).appointments.length, 0);
});

test('review and unrelated cards never become saveable', () => {
  assert.equal(resolve({}, { kind: 'review', reason: '未確定' }).review.length, 1);
  assert.equal(resolve({}, { kind: 'review' }).appointments.length, 0);
  assert.equal(resolve({}, { kind: 'other' }).appointments.length, 0);
});

test('an omitted optional reason in AI output does not discard valid appointments', () => {
  const withoutReason = { ...decision };
  delete withoutReason.reason;
  assert.equal(checkedMaterialDecisions({ cards: [withoutReason] }, [row])[0].reason, '');
  assert.throws(() => checkedMaterialDecisions({ cards: [{ ...decision, reason: 123 }] }, [row]));
});
