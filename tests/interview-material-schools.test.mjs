import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { schoolsFromAnswer } from '../src/lib/interview-material-schools.mjs';

test('extracts schools only from school answers and removes duplicates', () => {
  assert.deepEqual(schoolsFromAnswer([
    { label: '現状の第一志望校（任意回答）', value: '第1志望：浦和学院高等学校、 大宮高校' },
    { label: '第二志望校（任意回答）', value: '浦和学院高校' },
    { label: '志望校・成績・授業・勉強クラブの運営について、ご自由にご意見・ご希望をお聞かせください（任意回答）', value: '開智高校も検討中です。' },
  ]), ['浦和学院高等学校', '大宮高校']);
});

test('empty or undecided schools yield guide-only material selection', () => {
  assert.deepEqual(schoolsFromAnswer([{ label: '志望校', value: '未定、特になし' }]), []);
});

test('sorts shuffled survey fields by first, second, third choice and resolves Eimei', () => {
  assert.deepEqual(schoolsFromAnswer([
    { label: '第二志望校（任意回答）', value: '国府台' },
    { label: '現状の第一志望校（任意回答）', value: '柏の葉' },
    { label: '第三志望校（任意回答）', value: 'えいめい' },
  ]), ['柏の葉', '国府台', '叡明']);
});

test('resolves verified survey variants to the exact NAS school names', () => {
  assert.deepEqual(schoolsFromAnswer([
    { label: '第一志望校', value: '中央大学付属高校' },
    { label: '第二志望校', value: '三郷工業' },
    { label: '第三志望校', value: '埼玉県立越谷南高等学校' },
  ]), ['中央大学附属高等学校', '三郷工業技術高等学校', '越谷南高等学校']);
  assert.deepEqual(schoolsFromAnswer([{ label: '志望校', value: '中央大学杉並高等学校' }]), ['中央大学杉並高等学校']);
});
