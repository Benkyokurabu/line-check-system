'use client';
import { useRef, useState } from 'react';
import { materialAppointmentKey } from '@/lib/interview-material-batch.mjs';
import { runInterviewFolderBatch, type BatchFolderEntry } from './batch-interview-folders';
import { pickInterviewMaterialsFolder, interviewMaterialsSharePath, type DirectoryHandle, type MaterialAppointment } from './save-offline-folder';
import styles from './workspace.module.css';

export default function BatchFolderPanel({ date, teacherId, appointments, folderSupported, workerOnline, disabled, onBusyChange }: {
  date: string; teacherId: string; appointments: MaterialAppointment[]; folderSupported: boolean;
  workerOnline: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [entries, setEntries] = useState<BatchFolderEntry[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [stopping, setStopping] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const parentRef = useRef<DirectoryHandle | null>(null), runningRef = useRef(false), stopRef = useRef(false);
  const targets = appointments.filter(row => row.date === date && row.teacherId === teacherId);
  const available = Boolean(date && teacherId && targets.length && folderSupported && workerOnline && !disabled);
  async function start(retry: boolean) {
    if (!available || runningRef.current) return;
    const selected = retry ? entries.filter(entry => entry.status !== 'saved').map(entry => entry.appointment) : targets;
    if (!selected.length) return;
    let results: BatchFolderEntry[] = retry ? entries.map(entry => entry.status === 'saved' ? entry : { ...entry, status: 'pending', message: '未実施' })
      : targets.map(appointment => ({ appointment, status: 'pending', message: '未実施' }));
    runningRef.current = true; stopRef.current = false;
    setEntries(results); setBusy(true); onBusyChange(true); setStopping(false); setMessage('保存先「98面談資料」を選んでください。');
    try {
      const parent = parentRef.current ?? await pickInterviewMaterialsFolder();
      parentRef.current = parent;
      setMessage('Notionの予定と生徒・最新アンケートを再確認しています…');
      await runInterviewFolderBatch({ date, teacherId, appointments, targets: selected, parent, shouldStop: () => stopRef.current,
        onEntry: entry => {
          results = results.map(previous => materialAppointmentKey(previous.appointment) === materialAppointmentKey(entry.appointment) ? entry : previous);
          // AI callbacks from a previous attempt may finish while a retry is running.
          setEntries(previous => previous.map(saved => materialAppointmentKey(saved.appointment) === materialAppointmentKey(entry.appointment) ? entry : saved));
        },
      });
      const saved = results.filter(entry => entry.status === 'saved').length;
      const failed = results.filter(entry => entry.status === 'failed').length;
      const pending = results.filter(entry => entry.status === 'pending').length;
      setMessage(`${stopRef.current ? '停止しました。' : '処理が終わりました。'} 保存済み ${saved}/${results.length}人・失敗 ${failed}人・未実施 ${pending}人。${saved ? '保存した生徒フォルダの「面談資料.html」を開けます。' : ''}`);
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === 'AbortError' ? '保存先の選択を取り消しました。'
        : error instanceof Error ? error.message : 'まとめて保存できませんでした。');
    } finally { runningRef.current = false; setBusy(false); onBusyChange(false); }
  }
  return <section className={styles.batchPanel} aria-label="日付と先生からまとめて保存">
    <h3>その日の全員分をまとめて保存</h3>
    <p>{teacherId ? `対象：${targets.length}人` : '面談日と「面談の先生」を選んでください。'}</p>
    <p className={styles.note}>最新アンケートの志望校資料と、見つかった本人資料・面談記録・生徒情報を全員分保存します。アンケートがない生徒も本人資料を保存します。要確認の予定は保存対象外です。</p>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={!available || busy || entries.length > 0} onClick={() => void start(false)}>全員分のフォルダを作成</button>
      {!busy && entries.some(entry => entry.status !== 'saved') && <button type="button" disabled={!available} onClick={() => void start(true)}>失敗・未実施分を再試行</button>}
      {busy && <button type="button" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); setMessage('今の生徒の保存後に停止します。'); }}>この生徒の保存後に停止</button>}
    </div>
    {!folderSupported && <p className={styles.note}>まとめてフォルダを保存するにはChromeまたはEdgeを使用してください。</p>}
    {!workerOnline && <p className={styles.note}>作成PCの起動を確認してください。起動後「稼働状況を再確認」を押すと保存を開始できます。</p>}
    <p className={styles.note}>保存先は最初に1回選びます。処理中とAI要約の追記中は、この画面を開いたままにしてください。同名の保存済みフォルダは残し、再保存用の別フォルダを作ります。</p>
    <p className={styles.note}>{interviewMaterialsSharePath}</p>
    <button type="button" onClick={() => { void navigator.clipboard.writeText(interviewMaterialsSharePath)
      .then(() => setCopyMessage('共有フォルダの場所をコピーしました。保存先のアドレス欄へ貼り付けてください。'))
      .catch(() => setCopyMessage('表示した共有フォルダの場所を保存先のアドレス欄へ入力してください。')); }}>一括保存先の場所をコピー</button>
    {copyMessage && <p role="status">{copyMessage}</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {!!entries.length && <ol className={styles.batchResults} aria-label="全員分の保存結果">{entries.map(entry => <li key={materialAppointmentKey(entry.appointment)}
      data-status={entry.status}>
      <strong>{entry.appointment.start}　{entry.appointment.grade} {entry.appointment.name}</strong>
      <span>{entry.message}</span>{entry.path && <small>{entry.path}</small>}
      {!!entry.missing?.length && <small>未取得：{entry.missing.join('、')}</small>}
      {entry.summaryMessage && <small>{entry.summaryMessage}</small>}
    </li>)}</ol>}
  </section>;
}
