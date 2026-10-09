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

test('formats a confirmed appointment directly under its teacher in chronological order', () => {
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本美寿' }),
    ['工藤先生', '2026.10.05.2030-中３宮本美寿']);
});

test('rejects invalid dates and path separators', () => {
  assert.throws(() => interviewMaterialFolderParts({ date: '2026-02-30', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本' }));
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤先生', grade: '中2', name: '宮本/美寿' }),
    ['工藤先生', '2026.10.05.2030-中２宮本_美寿']);
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-09', start: '14:00', teacher: '工藤', grade: '中1', name: '石川 愛佳' }),
    ['工藤先生', '2026.10.09.1400-中１石川愛佳']);
});
