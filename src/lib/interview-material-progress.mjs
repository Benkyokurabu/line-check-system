const stages = ['checking_sources', 'checking_files', 'checking_saved', 'verifying_reuse', 'generating', 'uploading', 'saving'];
export function materialProgress(stage, mode) {
  if (!stages.includes(stage) || !['check', 'create', 'update', 'reuse'].includes(mode))
    throw Error('invalid_material_progress');
  if (['generating', 'uploading', 'saving'].includes(stage) && !['create', 'update'].includes(mode)
    || stage === 'verifying_reuse' && mode !== 'reuse'
    || ['checking_sources', 'checking_files', 'checking_saved'].includes(stage) && mode !== 'check')
    throw Error('invalid_material_progress');
  return { stage, mode, reportedAt: new Date().toISOString() };
}

/** @param {{status: string, skipped?: boolean, error?: string, attempts?: number, progress?: {stage?: string, mode?: string}}} job */
export function materialJobStatus(job) {
  if (job.status === 'completed') return job.skipped
    ? { label: '変更なし・既存資料を使用', detail: 'PDFと保存済み資料は再作成していません。' }
    : { label: '共有フォルダへ保存済み', detail: '資料の作成と保存後の確認が完了しました。' };
  if (job.status === 'failed') return { label: `失敗：${job.error || '処理を完了できませんでした。'}`,
    detail: (job.attempts ?? 3) < 3 ? '5分後に再試行します。以前の保存済み資料は保持しています。' : '自動再試行は終了しました。以前の保存済み資料は保持しています。' };
  if (job.status !== 'running') return { label: '確認待ち', detail: '作成PCの順番待ちです。まだ確認・再作成は始まっていません。' };
  const stage = job.progress?.stage;
  if (stage === 'checking_sources') return { label: '面談予定・元情報を確認中', detail: '面談予定・アンケート・面談記録・生徒情報を確認しています。まだ再作成していません。' };
  if (stage === 'checking_files') return { label: '指導簿・成績資料を確認中', detail: '本人の資料と更新状況を確認しています。まだ再作成していません。' };
  if (stage === 'checking_saved') return { label: '保存済み資料と変更点を照合中', detail: '元資料と保存済みファイルを照合しています。まだ再作成していません。' };
  if (stage === 'verifying_reuse') return { label: '変更なし・再利用の最終確認中', detail: '保存済み資料をそのまま使えるか確認しています。再作成していません。' };
  if (stage === 'generating') return job.progress?.mode === 'create'
    ? { label: '初回の資料・PDFを作成中', detail: '再利用できる保存済み資料がないため、新しく作成しています。' }
    : { label: '更新が必要な資料・PDFを再作成中', detail: '元資料・画面の変更、または保存済みファイルの不足などに対応しています。' };
  if (stage === 'uploading') return { label: '作成したPDFを保管中', detail: '完成したPDFを作成PCと非公開保管先へ保存しています。面談フォルダへの保存はまだ完了していません。' };
  if (stage === 'saving') return { label: '共有フォルダへ保存・最終確認中', detail: '面談フォルダへの保存、元資料と保存内容の確認を進めています。' };
  return { label: '処理中・詳細の報告待ち', detail: '作成PCから工程の報告を待っています。再作成中かどうかはまだ確認できません。' };
}
