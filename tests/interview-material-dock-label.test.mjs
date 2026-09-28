import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialDockLabel } from '../src/app/staff/interview-materials/material-dock-label.ts';

test('Tachibana school scans keep their requested names when an older job says only 資料', () => {
  const items = [
    { label: '資料', source: String.raw`\\TS3210\benko\06 高校情報\2027年★晶文社高校受験案内／高校別スキャンデータ\こ　越谷北高等学校.jpg` },
    { label: '資料', source: String.raw`\\TS3210\benko\06 高校情報\2026年★高校別【北辰偏差値】基礎資料\こ越谷北.jpg` },
  ];
  assert.deepEqual(items.map(materialDockLabel), ['晶文社', '北辰基礎資料']);
});

test('individual Hokushin results retain their own name', () => {
  assert.equal(materialDockLabel({ label: '北辰成績', source: '北辰テスト_個人成績票PDF/立花朋也.pdf' }), '北辰成績');
});
