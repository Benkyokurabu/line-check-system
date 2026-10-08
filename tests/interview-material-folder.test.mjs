import test from 'node:test';
import assert from 'node:assert/strict';
import { individualInterviewMaterialFolderParts, interviewMaterialFolderParts } from '../src/lib/interview-material-folder.mjs';

test('individual folders need no appointment and distinguish students with the same name', () => {
  assert.deepEqual(individualInterviewMaterialFolderParts({ number: '2018998', name: '確認用 生徒', grade: '中3' }),
    ['個別保存', '中3 確認用 生徒（2018998）']);
  assert.notDeepEqual(individualInterviewMaterialFolderParts({ number: '2018998', name: '同名', grade: '中3' }),
    individualInterviewMaterialFolderParts({ number: '2018999', name: '同名', grade: '中3' }));
  assert.deepEqual(individualInterviewMaterialFolderParts({ number: '2018998', name: '確認/生徒', grade: '中3' }),
    ['個別保存', '中3 確認_生徒（2018998）']);
  assert.throws(() => individualInterviewMaterialFolderParts({ number: '../student', name: '確認用', grade: '中3' }));
});

test('formats a confirmed autumn appointment under teacher and grade', () => {
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本美寿' }),
    ['工藤先生', '2026中３秋の教育相談会', '2026.10.05 20：30- 宮本美寿']);
});

test('rejects invalid dates and path separators', () => {
  assert.throws(() => interviewMaterialFolderParts({ date: '2026-02-30', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本' }));
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤先生', grade: '中2', name: '宮本/美寿' }),
    ['工藤先生', '2026中２秋の教育相談会', '2026.10.05 20：30- 宮本_美寿']);
});
