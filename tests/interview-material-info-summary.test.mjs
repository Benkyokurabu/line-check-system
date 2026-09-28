import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedSummary, infoSourceHash } from '../src/lib/interview-material-info-summary.mjs';

test('summary keeps a source and its original text', () => {
  const fields = [{ source: '連絡先　備考', value: '面談は母へ連絡' }];
  assert.equal(infoSourceHash(fields).length, 64);
  assert.deepEqual(checkedSummary({ notes: [{ source: '連絡先　備考', note: '面談連絡は母へ。' }] }, fields),
    [{ source: '連絡先　備考', note: '面談連絡は母へ。', original: '面談は母へ連絡' }]);
  assert.throws(() => checkedSummary({ notes: [{ source: '住所', note: '自宅へ行く' }] }, fields), /出典/);
});
