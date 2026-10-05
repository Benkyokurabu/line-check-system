import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewMaterialFolderParts } from '../src/lib/interview-material-folder.mjs';

test('formats a confirmed autumn appointment under teacher and grade', () => {
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本美寿' }),
    ['工藤先生', '2026中３秋の教育相談会', '2026.10.05 20：30- 宮本美寿']);
});

test('rejects invalid dates and path separators', () => {
  assert.throws(() => interviewMaterialFolderParts({ date: '2026-02-30', start: '20:30', teacher: '工藤', grade: '中3', name: '宮本' }));
  assert.deepEqual(interviewMaterialFolderParts({ date: '2026-10-05', start: '20:30', teacher: '工藤先生', grade: '中2', name: '宮本/美寿' }),
    ['工藤先生', '2026中２秋の教育相談会', '2026.10.05 20：30- 宮本_美寿']);
});
