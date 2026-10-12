'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import styles from '@/app/interviews/interviews.module.css';
type Staff = { displayName: string; role: string };
type Person = { id: string; display_name: string };
export default function Workspace() {
  const [staff, setStaff] = useState<Staff | null>(null), [ready, setReady] = useState(false);
  const [people, setPeople] = useState<Person[]>([]), [name, setName] = useState(''), [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch('/api/staff/login-people/manage', { cache: 'no-store' }), body = await response.json();
    if (!response.ok) throw Error(body.error ?? '一覧を取得できませんでした。');
    setPeople(body.people);
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/staff/session', { cache: 'no-store' }), body = await response.json();
        if (response.status === 401) return;
        if (!response.ok) throw Error(body.error ?? '認証を確認できませんでした。');
        if (active) setStaff(body.staff);
        if (body.staff.role === 'admin') await load();
      } catch (error) { if (active) setMessage((error as Error).message); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [load]);
  async function work(task: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage('');
    try { await task(); } catch (error) { setMessage((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); await work(async () => {
      const secret = password; setPassword('');
      const response = await fetch('/api/staff/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffCode: code.trim().toUpperCase(), password: secret }) }), body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'ログインできませんでした。');
      setStaff(body.staff); if (body.staff.role === 'admin') await load();
    });
  }
  async function add(event: FormEvent) {
    event.preventDefault(); await work(async () => {
      const response = await fetch('/api/staff/login-people/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }), body = await response.json();
      if (!response.ok) throw Error(response.status === 409 ? 'この名前は既に登録されています。' : body.error ?? '追加できませんでした。');
      setName(''); await load(); setMessage(`${body.person.display_name}さんを追加しました。`);
    });
  }
  return <main className={styles.screen}><header className={styles.header}><div><h1>ログインする人の管理</h1><p>先生ログインの名前一覧を管理します。追加した人は共通パスワードでログインできます。</p></div></header>
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {!ready ? <p>ログイン状態を確認しています…</p> : !staff ? <form className={styles.panel} onSubmit={login} aria-label="管理者ログイン"><h2>管理者ログイン</h2><label>職員コード<input required disabled={busy} autoComplete="username" value={code} onChange={event => setCode(event.target.value)} /></label><label>パスワード<input required disabled={busy} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button className={styles.primary} disabled={busy}>ログイン</button></form> : staff.role !== 'admin' ? <section className={styles.panel}><h2>管理者専用です</h2><p>名前の追加は管理者が行います。</p></section> : <>
      <form className={styles.panel} onSubmit={add} aria-label="ログインする人を追加"><h2>ログインする人を追加</h2><label>表示する名前<input required maxLength={50} disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder="例：佐藤（新）" /></label><p>管理者権限は付与されません。同姓の人は括弧などで区別してください。</p><button className={styles.primary} disabled={busy || !name.trim()}>名前を追加</button></form>
      <section className={styles.panel} aria-label="登録済みの人"><h2>登録済みの人（{people.length}名）</h2><ol>{people.map(person => <li key={person.id}>{person.display_name}</li>)}</ol></section>
    </>}
  </main>;
}
