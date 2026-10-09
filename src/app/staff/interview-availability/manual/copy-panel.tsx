'use client';
import {useEffect, useRef, useState} from 'react';
import {nextWeekCopyRange, validateCopyRange} from '@/lib/availability-copy-core.mjs';
import styles from '@/app/interviews/interviews.module.css';

type Result = {teacher: string; teacherId: string; from: string; to: string; text: string; rows: unknown[]; checkedAt: string; reviewCount: number};
export default function AvailabilityCopyPanel() {
  const [teachers, setTeachers] = useState<{id: string; name: string}[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [range, setRange] = useState(() => nextWeekCopyRange());
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/staff/interview-availability-copy?mode=teachers', {cache: 'no-store', signal: controller.signal})
      .then(async response => {const body = await response.json(); if (!response.ok) throw Error(body.error); setTeachers(body.teachers); setTeacherId(body.defaultTeacherId || '');})
      .catch(error => {if (!controller.signal.aborted) setMessage(error.message || '先生の一覧を取得できませんでした。');})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, []);
  function changeRange(next: {from: string; to: string}) {setRange(next); setResult(null); setMessage('');}
  async function load() {
    if (busy) return;
    try {validateCopyRange(range.from, range.to);} catch (error) {setMessage((error as Error).message); return;}
    setBusy(true); setResult(null); setMessage('');
    try {
      const query = new URLSearchParams({...range, teacherId});
      const response = await fetch(`/api/staff/interview-availability-copy?${query}`, {cache: 'no-store'}), body = await response.json();
      if (!response.ok) throw Error(body.error || '予約可を取得できませんでした。');
      setResult(body);
    } catch (error) {setMessage((error as Error).message);} finally {setBusy(false);}
  }
  async function copy() {
    if (!result?.text) return;
    try {await navigator.clipboard.writeText(result.text); setMessage(`${result.rows.length}件の予約可能枠をコピーしました。`);}
    catch {area.current?.focus(); area.current?.select(); setMessage('自動コピーができませんでした。選択された一覧をコピーしてください。');}
  }
  return <section className={styles.panel} aria-label="予約可能枠をコピー">
    <h2>予約可能枠をコピー</h2><p>先生と期間を選び、Notionのベンスケに登録された「予約可」を番号付きの日程一覧にします。</p>
    <fieldset disabled={busy || loading}>
      <label>担当の先生<select value={teacherId} onChange={event => {setTeacherId(event.target.value); setResult(null); setMessage('');}}><option value="">先生を選んでください</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
      <label>開始日<input type="date" value={range.from} onChange={event => changeRange({...range, from: event.target.value})}/></label>
      <label>終了日<input type="date" value={range.to} onChange={event => changeRange({...range, to: event.target.value})}/></label>
      <div className={styles.actions}><button className={styles.primary} disabled={!teacherId} onClick={() => void load()}>{busy ? '取得中…' : 'Notionから予約可を取得'}</button></div>
    </fieldset>
    {loading && <p role="status">先生の一覧を読み込んでいます…</p>}
    {!loading && teachers.length === 0 && <button onClick={() => window.location.reload()}>先生の一覧を再取得</button>}
    {result && <div><p><strong>{result.teacher} ／ {result.from}〜{result.to} ／ {result.rows.length}件</strong></p><small>Notionから取得：{new Date(result.checkedAt).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}</small>
      {result.reviewCount > 0 && <p>日時の確認が必要な予約可{result.reviewCount}件を除外しました。Notionで確認してください。</p>}
      {result.rows.length ? <><label>コピーする日程<textarea ref={area} readOnly value={result.text} rows={Math.min(20, result.rows.length + 1)} style={{whiteSpace: 'pre', overflowX: 'auto', fontSize: 14}}/></label><button className={styles.primary} onClick={() => void copy()}>日程一覧をコピー</button></> : <p className={styles.empty}>この期間の予約可能枠はありません。</p>}
    </div>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
  </section>;
}
