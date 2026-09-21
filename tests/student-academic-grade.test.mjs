import assert from 'node:assert/strict';
import { test } from 'node:test';
import { academicGrade, withAcademicGrade, withContactAcademicGrades } from '../src/lib/student-academic-grade.mjs';

test('正式番号のコホートと現行名簿の全学年が一致する', () => {
  const at = new Date('2026-09-21T00:00:00+09:00');
  for (const [number, grade] of [['2023001','小4'],['2022001','小5'],['2021001','小6'],['2020001','中1'],['2019001','中2'],['2018001','中3'],['2017001','高1'],['2016000','高2'],['2015001','高3']]) {
    assert.equal(academicGrade(number,at),grade);
  }
});
test('Notionと同じ3月1日JSTに進級し、1月と4月には重ねて進級しない', () => {
  for (const [at,grade] of [['2026-12-31T23:59:59+09:00','高2'],['2027-01-01T00:00:00+09:00','高2'],['2027-02-28T14:59:59Z','高2'],['2027-02-28T15:00:00Z','高3'],['2027-04-01T00:00:00+09:00','高3'],['2028-02-29T15:00:00Z','約19才']]) {
    assert.equal(academicGrade('2016000',new Date(at)),grade);
  }
});
test('進学境界と未就学・不正番号・仮番号を区別する', () => {
  const at=new Date('2027-03-01T00:00:00+09:00');
  assert.equal(academicGrade('2021001',at),'中1');
  assert.equal(academicGrade('2018001',at),'高1');
  for(const number of ['notion:abc','',null,'201600','20160000','abcd000','1899000','2028001']) assert.equal(academicGrade(number,at),null);
  assert.equal(academicGrade('2016000',new Date('invalid')),null);
  const temporary={student_number:'notion:abc',grade:'高2'};
  assert.equal(withAcademicGrade(temporary,at),temporary);
});
test('登録一覧と検索の学年は一致し、卒塾状態・LINE関係・履歴は変えない', () => {
  const student={student_number:'2016000',grade:'高2',enrollment_status:'卒塾',relation:'guardian',verification_status:'confirmed'};
  const at=new Date('2027-03-01T00:00:00+09:00');
  const history=[{grade:'高2'}];
  const contact=withContactAcademicGrades({registered_accounts:[student],history},at);
  assert.deepEqual(contact.registered_accounts,[{...student,grade:'高3'}]);
  assert.deepEqual(contact.registered_accounts[0],withAcademicGrade(student,at));
  assert.equal(student.grade,'高2');
  assert.equal(contact.history,history);
});
