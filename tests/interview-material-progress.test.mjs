import test from 'node:test';
import assert from 'node:assert/strict';
import { materialJobStatus, materialProgress } from '../src/lib/interview-material-progress.mjs';

test('reported stages distinguish checks, reuse, generation and both save destinations', () => {
  for (const stage of ['checking_sources', 'checking_files', 'checking_saved']) {
    const text = materialJobStatus({status: 'running', progress: materialProgress(stage, 'check')});
    assert.match(text.detail, /まだ再作成していません/);
    assert.doesNotMatch(text.label, /作成中/);
  }
  assert.match(materialJobStatus({status:'running',progress:materialProgress('verifying_reuse','reuse')}).label,/再利用の最終確認/);
  assert.equal(materialJobStatus({status:'running',progress:materialProgress('generating','create')}).label,'初回の資料・PDFを作成中');
  assert.equal(materialJobStatus({status:'running',progress:materialProgress('generating','update')}).label,'更新が必要な資料・PDFを再作成中');
  assert.match(materialJobStatus({status:'running',progress:materialProgress('uploading','update')}).detail,/面談フォルダへの保存はまだ完了していません/);
  assert.equal(materialJobStatus({status:'running',progress:materialProgress('saving','update')}).label,'共有フォルダへ保存・最終確認中');
  for (const [stage,mode] of [['bad','check'],['generating','check'],['verifying_reuse','update'],['checking_saved','create'],['saving','reuse']])
    assert.throws(()=>materialProgress(stage,mode),/invalid_material_progress/);
});
test('completion and failure take precedence over old progress; missing reports do not imply generation', () => {
  assert.equal(materialJobStatus({status:'queued'}).label,'確認待ち');
  assert.match(materialJobStatus({status:'running'}).detail,/再作成中かどうかはまだ確認できません/);
  assert.equal(materialJobStatus({status:'completed',skipped:true,progress:{stage:'generating'}}).label,'変更なし・既存資料を使用');
  assert.equal(materialJobStatus({status:'completed',skipped:false}).label,'共有フォルダへ保存済み');
  assert.match(materialJobStatus({status:'failed',attempts:2,error:'保存先未接続'}).detail,/5分後/);
  assert.match(materialJobStatus({status:'failed',attempts:3}).detail,/自動再試行は終了/);
});
