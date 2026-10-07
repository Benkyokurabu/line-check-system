'use client';
import { useState } from 'react';
import styles from './workspace.module.css';

type DailyState = { settings: { enabled: boolean; run_time: string; days_ahead: number } | null;
  scans: { target_date: string; status: string; error?: string; report?: { review?: unknown[]; changed?: unknown[] } }[];
  jobs: { id: string; status: string; appointment: { date: string; start: string; name: string; teacher: string };
    error?: string; savedFolder?: string; skipped: boolean; missing: string[]; attempts: number }[] };

export default function DailyMaterialPanel() {
  const [state, setState] = useState<DailyState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch('/api/staff/interview-material-daily', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || '自動作成の状況を取得できません。');
      setState(value); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '自動作成の状況を取得できません。'); }
    finally { setBusy(false); }
  }
  return <details className={styles.batchPanel} onToggle={event => { if (event.currentTarget.open && !state && !busy) void refresh(); }}>
    <summary>毎日の自動作成・保存状況</summary>
    {state?.settings && <p>{state.settings.enabled ? `毎日${state.settings.run_time.slice(0, 5)}（日本時間）に、本日から${state.settings.days_ahead}日先までの確定面談を確認します。`
      : '毎日の自動作成は停止中です。'}</p>}
    <p className={styles.note}>成功した資料一式を先生別の共有フォルダへ保存します。変更がない資料はそのまま使い、失敗時は以前の資料を残します。先生が追加したファイルは保持します。</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? '状況を確認中…' : '自動作成の状況を再確認'}</button>
    {error && <p role="status">{error}</p>}
    {state && <>
      {state.scans.map(scan => <p key={scan.target_date}>{scan.target_date}：{scan.status === 'completed' ? '予定の確認済み' : scan.status === 'failed' ? `巡回失敗：${scan.error}` : '予定を確認中'}
        {!!scan.report?.review?.length && ` ／ 要確認 ${scan.report.review.length}件`}
        {!!scan.report?.changed?.length && ` ／ 変更・取消 ${scan.report.changed.length}件（以前の資料は保持）`}</p>)}
      <ol className={styles.batchResults} aria-label="自動作成の結果">{state.jobs.map(job => <li key={job.id}>
        <strong>{job.appointment.date} {job.appointment.start}　{job.appointment.name}（{job.appointment.teacher}先生）</strong>
        <span>{job.status === 'completed' ? job.skipped ? '変更なし・保存済み資料を使用' : '共有フォルダへ保存済み'
          : job.status === 'failed' ? `失敗：${job.error}${job.attempts < 3 ? '（5分後に再試行）' : ''}` : job.status === 'running' ? '資料を作成中' : '作成待ち'}</span>
        {job.savedFolder && <small>{job.savedFolder} の「面談資料.html」を開けます。</small>}
        {!!job.missing.length && <small>未取得：{job.missing.join('、')}</small>}
      </li>)}</ol>
      {!state.jobs.length && <p>今日の自動作成依頼はまだありません。</p>}
    </>}
  </details>;
}
