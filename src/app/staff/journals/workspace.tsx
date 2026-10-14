'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import StaffLogin, {type LoginStaff} from '@/components/staff-login';
import {JOURNAL_SUBJECTS,openJournalTabs,selectJournalFiles} from '@/lib/journal-browser.mjs';
import styles from './journals.module.css';
type Journal = {id:string;name:string;campus:string;grade:string;subject:string;subjectId:string;kind:string;url:string};
export default function JournalWorkspace() {
  const [ready,setReady] = useState(false), [staff,setStaff] = useState<LoginStaff|null>(null);
  const [subject,setSubject] = useState(''), [campus,setCampus] = useState('全部');
  const [files,setFiles] = useState<Journal[]>([]), [year,setYear] = useState<number|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [blocked,setBlocked] = useState<Journal[]>([]), sequence = useRef(0);
  const visible:Journal[] = selectJournalFiles(files,subject,campus);
  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setBusy(true); setError(''); setFiles([]); setBlocked([]); setNotice('');
    try {
      const response = await fetch('/api/staff/journals',{cache:'no-store'}), body = await response.json();
      if (requestId !== sequence.current) return;
      if (!response.ok) { if (response.status === 401) setStaff(null); throw Error(body.error ?? '授業日誌を取得できませんでした。'); }
      setFiles(body.files); setYear(body.year);
    } catch (error) { if (requestId === sequence.current) setError(error instanceof Error ? error.message : '授業日誌を取得できませんでした。'); }
    finally { if (requestId === sequence.current) setBusy(false); }
  },[]);
  useEffect(() => {
    let active = true;
    const requests = sequence;
    void fetch('/api/staff/session',{cache:'no-store'}).then(async response => {
      const body = await response.json();
      if (!active) return;
      if (response.ok) { setStaff(body.staff); void load(); }
      else if (response.status !== 401) setError(body.error ?? 'ログイン状態を確認できませんでした。');
    }).catch(() => { if (active) setError('勉たんに接続できませんでした。再読み込みしてください。'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; requests.current++; };
  },[load]);
  function resetResult() { setBlocked([]); setNotice(''); }
  function open(filesToOpen:Journal[]) {
    const result = openJournalTabs(filesToOpen);
    setBlocked(result.blocked);
    setNotice(result.blocked.length
      ? `${result.requested}件のタブを開くよう送信しました。${result.blocked.length}件はブラウザにブロックされました。`
      : `${result.requested}件のタブを開くよう送信しました。`);
  }
  return <main className={styles.workspace}>
    <h1>授業日誌の確認</h1><p>科目と校舎を選び、OneDriveの授業日誌をまとめて開きます。</p>
    {!ready ? <p role="status">ログイン状態を確認しています…</p> : !staff ? <StaffLogin onLogin={person=>{setStaff(person);void load();}}/> : <>
      <section className={styles.panel} aria-labelledby="subject-title">
        <h2 id="subject-title">1. 科目を選ぶ</h2>
        <div className={styles.subjects}>{JOURNAL_SUBJECTS.map(item => <button key={item.id} type="button" aria-pressed={subject===item.id}
          onClick={() => {setSubject(item.id);resetResult();}}>{item.label}</button>)}</div>
      </section>
      {subject && <section className={styles.panel} aria-labelledby="campus-title">
        <h2 id="campus-title">2. 開く校舎を選ぶ</h2>
        <fieldset className={styles.campuses}><legend>校舎</legend>{['本校','南教室','全部'].map(item => <label key={item}>
          <input type="radio" name="journal-campus" value={item} checked={campus===item} onChange={() => {setCampus(item);resetResult();}}/>{item}
        </label>)}</fieldset>
        <p className={styles.summary}>{busy ? 'OneDriveの授業日誌を読み込んでいます…' : year ? `${year}年度 ／ ${JOURNAL_SUBJECTS.find(item=>item.id===subject)?.label} ／ ${campus}：${visible.length}件` : ''}</p>
        <button type="button" className={styles.primary} disabled={busy || !visible.length || !!error} onClick={() => open(visible)}>ブラウザで開く</button>
        <p className={styles.hint}>通常授業・X・補講を含め、日誌ごとに別のタブで開きます。</p>
        {!busy && !error && !visible.length && <p>この科目の日誌はありません。</p>}
      </section>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {blocked.length > 0 && <section className={styles.panel} aria-label="ブロックされた日誌">
        <h2>開けなかった日誌</h2><p>アドレスバー右端のポップアップ表示から、このサイトのポップアップを許可して、再度開いてください。</p>
        <button type="button" className={styles.primary} onClick={() => open(blocked)}>開けなかった日誌を開く</button>
        <details><summary>1件ずつ開く</summary><ul>{blocked.map(file => <li key={file.id}><a href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a></li>)}</ul></details>
      </section>}
      {error && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load()}>日誌を再読み込み</button>}
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </main>;
}
