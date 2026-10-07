'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './workspace.module.css';

type State = { workers: { id: string; name: string }[]; jobs: { id: string; status: string;
  appointment: { date: string; start: string; name: string; teacher: string };
  savedFolder?: string; skipped: boolean; missing: string[]; error?: string; attempts: number }[] };
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const nextWeek = () => new Date(Date.parse(today()) + 7 * 86400000).toISOString().slice(0, 10);
export default function ManualMaterialPanel({ teachers }: { teachers: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(today), [to, setTo] = useState(nextWeek), [teacherId, setTeacherId] = useState('');
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ runId: string; from: string; to: string; teacherId: string } | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch('/api/staff/interview-material-run', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || '一括作成の状況を取得できません。');
    setState(body); setError('');
  }, []);
  useEffect(() => {
    let active = true;
    const poll = () => { if (active) void refresh().catch(caught => { if (active) setError(caught.message); }); };
    poll();
    const timer = window.setInterval(poll, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);
  const running = state?.jobs.some(job => ['queued', 'running'].includes(job.status)) ?? false;
  async function start() {
    if (busy || running || !state?.workers.length) return;
    setBusy(true); setError(''); setMessage('Notionの確定面談を確認しています…');
    request.current ??= { runId: crypto.randomUUID(), from, to, teacherId };
    try {
      const response = await fetch('/api/staff/interview-material-run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.current), signal: AbortSignal.timeout(65000) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || '作成依頼を受け付けられませんでした。');
      request.current = null;
      setMessage(body.accepted ? `${body.accepted}件の作成を受け付けました。${body.worker}で処理します。画面を閉じても作成は続きます。`
        : '選んだ範囲に、これから実施する確定面談はありません。');
      if (body.reviewCount) setMessage(previous => `${previous} 本人・日時などの確認が必要な予定は${body.reviewCount}件あり、作成対象に含めていません。`);
      try { await refresh(); } catch { setError('受付済みです。状況の取得に失敗しました。「作成状況を再確認」を押してください。'); }
    } catch (caught) {
      setMessage(''); setError((caught as Error).message);
      // Retry the same request ID after an uncertain network response, avoiding duplicate jobs.
    } finally { setBusy(false); }
  }
  return <section className={styles.card} aria-label="確定面談の一括作成">
    <h2>確定面談の資料をまとめて作成</h2>
    <p>「面談資料作成」を押した時だけ、起動中の作成PCで資料を作り、先生別の共有フォルダへ保存します。</p>
    <label>作成対象の開始日<input type="date" value={from} min={today()} disabled={busy || running} onChange={event => {
      request.current = null;
      const value = event.target.value;
      setFrom(value); setTo(value ? new Date(Date.parse(value) + 7 * 86400000).toISOString().slice(0, 10) : '');
    }} /></label>
    <label>作成対象の終了日<input type="date" value={to} min={from} disabled={busy || running} onChange={event => { request.current = null; setTo(event.target.value); }} /></label>
    <label>一括作成の先生<select value={teacherId} disabled={busy || running} onChange={event => { request.current = null; setTeacherId(event.target.value); }}>
      <option value="">全先生</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}先生</option>)}
    </select></label>
    <p className={styles.note}>最新のアンケート・指導簿・成績資料・面談記録を使います。変更なしの場合は以前の資料を使い、失敗時も以前の資料を残します。</p>
    <p role="status">{state ? state.workers.length ? `使用できるPC：${state.workers.map(worker => worker.name).join('、')}`
      : '一括作成に対応したPCが停止中です。作成アプリの起動・更新とNAS接続を確認してください。' : '作成PCを確認中…'}</p>
    <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || running || !state?.workers.length} onClick={() => void start()}>
      {busy ? '確定面談を確認中…' : running ? '面談資料を作成中' : '面談資料作成'}</button>
      <button type="button" disabled={busy} onClick={() => void refresh().catch(caught => setError(caught.message))}>作成状況を再確認</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
    {!!state?.jobs.length && <ol className={styles.batchResults} aria-label="一括作成の結果">{state.jobs.map(job => <li key={job.id}>
      <strong>{job.appointment.date} {job.appointment.start}　{job.appointment.name}（{job.appointment.teacher}先生）</strong>
      <span>{job.status === 'completed' ? job.skipped ? '変更なし・保存済み資料を使用' : '共有フォルダへ保存済み'
        : job.status === 'failed' ? `失敗：${job.error}${job.attempts < 3 ? '（5分後に再試行）' : ''}` : job.status === 'running' ? '資料を作成中' : '作成待ち'}</span>
      {job.savedFolder && <small>{job.savedFolder} の「面談資料.html」を開けます。</small>}
      {!!job.missing?.length && <small>未取得：{job.missing.join('、')}</small>}
    </li>)}</ol>}
  </section>;
}
