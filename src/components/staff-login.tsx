'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import styles from '@/app/interviews/interviews.module.css';

export type LoginStaff = { staffId: string; staffCode: string; displayName: string; role: string };
type Teacher = { id: string; display_name: string };
export default function StaffLogin({ onLogin }: { onLogin: (staff: LoginStaff) => void }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]), [teacherId, setTeacherId] = useState('');
  const [mode, setMode] = useState<'teacher' | 'staff'>('teacher'), [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void fetch('/api/staff/login-people', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw Error('先生一覧を読み込めませんでした。');
      const body = await response.json(); if (active) setTeachers(body.teachers ?? []);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const secret = password; setPassword('');
    try {
      const response = await fetch(mode === 'teacher' ? '/api/staff/availability-login' : '/api/staff/session', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'teacher' ? { teacherId, password: secret } : { staffCode: code.trim().toUpperCase(), password: secret }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'ログインできませんでした。');
      onLogin(body.staff);
      window.dispatchEvent(new Event('bentan:staff-session-active'));
    } catch (error) { setError((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className={styles.panel} onSubmit={login} aria-label="職員ログイン">
    <h2>{mode === 'teacher' ? '先生ログイン' : '職員ログイン'}</h2>
    <p>ログイン後、この画面で続けられます。同じPC・ブラウザでは、ログアウトするまで他の機能にもログインを引き継ぎます。</p>
    {mode === 'teacher' ? <label>先生の名前<select required disabled={busy} value={teacherId} onChange={event => setTeacherId(event.target.value)}>
      <option value="">選択してください</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.display_name}先生</option>)}
    </select></label> : <label>職員コード<input required disabled={busy} autoComplete="username" value={code} onChange={event => setCode(event.target.value)} /></label>}
    <label>{mode === 'teacher' ? '共通パスワード' : 'パスワード'}<input required disabled={busy} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
    {error && <p role="alert" className={styles.notice}>{error}</p>}
    <div className={styles.actions}><button className={styles.primary} disabled={busy || mode === 'teacher' && !teachers.length}>{busy ? 'ログイン中…' : 'ログイン'}</button>
      <button type="button" disabled={busy} onClick={() => { setMode(mode === 'teacher' ? 'staff' : 'teacher'); setPassword(''); setError(''); }}>{mode === 'teacher' ? '職員コードでログイン' : '先生名でログイン'}</button></div>
  </form>;
}
