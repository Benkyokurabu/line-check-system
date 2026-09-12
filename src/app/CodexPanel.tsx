'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './codex-panel.module.css';

type PageContext = { path: string; title: string; selection: string; element: string };
type Job = { id: string; message: string; page_context: PageContext; response: string; progress: string; status: string; cancel_requested: boolean; approval?: { id: string; message: string } };
const active = (job: Job) => ['queued','running','awaiting_approval'].includes(job.status);
const labels: Record<string,string> = { queued:'受付済み',running:'作業中',awaiting_approval:'確認待ち',completed:'回答済み',failed:'中断・要確認',cancelled:'停止済み' };
export function CodexPanel() {
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<PageContext | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [error, setError] = useState('');
  const [older, setOlder] = useState<string[]>([]);
  const serial = useRef(false);
  const generation = useRef(0);
  const retry = useRef<{ action: string; id: string; conversationId: string; message: string; context: PageContext } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const load = useCallback(async (id: string, signal?: AbortSignal) => {
    const epoch = generation.current;
    const response = await fetch(`/api/codex${id ? `?conversationId=${id}` : ''}`, { cache:'no-store', signal });
    const data = await response.json();
    if (epoch !== generation.current) return;
    if (response.status === 401 || response.status === 403) {
      setAuthorized(false); setJobs([]); setOpen(false); setMessage(''); setSelection(null); retry.current=null; setRetryPending(false); return;
    }
    if (!response.ok) throw new Error(data.error || 'Codexの接続を確認できませんでした。');
    setAuthorized(true); setOnline(data.online);
    if (data.requests) {
      setJobs(data.requests);
      if (retry.current && data.requests.some((job: Job) => job.id === retry.current?.id)) {
        retry.current=null; setRetryPending(false); setMessage(''); setSelection(null);
      }
    }
    setError(previous => previous.startsWith('接続を確認できません') ? '' : previous);
  }, []);
  useEffect(() => {
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem('bentan-codex-conversations') || '[]'); } catch {}
    saved = Array.isArray(saved) ? saved.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0,20) : [];
    const id = saved[0] || crypto.randomUUID();
    // Restore identifiers only. Conversation contents stay behind server authentication.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversationId(id); setOlder(saved.length ? saved : [id]);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { await load(open ? conversationId : '', controller.signal); }
      catch { if (!controller.signal.aborted && open) { setOnline(false); setError('接続を確認できません。自動で再接続します。'); } }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(refresh, open ? 2500 : 15000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus',refresh); };
  }, [load, open, conversationId, pathname]);
  useEffect(() => {
    const container = history.current;
    if (container && followLatest.current) container.scrollTop = container.scrollHeight;
  }, [jobs, open, picking]);
  useEffect(() => { if (open && !picking) input.current?.focus(); }, [open,picking]);
  useEffect(() => {
    if (!picking) return;
    let highlighted: HTMLElement | null = null;
    let oldOutline = '';
    const restore = () => { if (highlighted) highlighted.style.outline = oldOutline; highlighted = null; };
    const hover = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.closest('[data-codex-panel]')) return;
      restore(); highlighted = event.target; oldOutline = highlighted.style.outline; highlighted.style.outline = '3px solid #027b80';
    };
    const choose = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.closest('[data-codex-panel]')) return;
      event.preventDefault(); event.stopPropagation();
      const el = event.target;
      const safe = el.cloneNode(true) as HTMLElement;
      safe.querySelectorAll('input,textarea,select,script,style,[data-private],[data-sensitive]').forEach((node) => node.remove());
      const privateElement = !!el.closest('input,textarea,select,[data-private],[data-sensitive]');
      setSelection({ path: window.location.pathname, title: document.title.slice(0,150),
        selection: privateElement ? '入力欄（値は共有しません）' : (safe.textContent || '').trim().replace(/\s+/g,' ').slice(0,1000),
        element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id.slice(0,100)}` : ''} ${el.getAttribute('role') || ''}`.slice(0,300) });
      restore(); setPicking(false); setOpen(true);
    };
    const key = (event: KeyboardEvent) => { if (event.key==='Escape') { setPicking(false); setOpen(true); } };
    document.addEventListener('mousemove',hover,true); document.addEventListener('click',choose,true); document.addEventListener('keydown',key,true);
    return () => { restore(); document.removeEventListener('mousemove',hover,true); document.removeEventListener('click',choose,true); document.removeEventListener('keydown',key,true); };
  }, [picking]);
  async function mutate(body: Record<string,unknown>) {
    if (serial.current) return;
    serial.current=true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/codex',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setAuthorized(false); setJobs([]); setMessage(''); retry.current=null; setRetryPending(false); }
        throw new Error(data.error || '送信を確認できませんでした。同じ内容で再試行できます。');
      }
      if (body.action==='send') { retry.current=null; setRetryPending(false); setMessage(''); setSelection(null); }
      await load(conversationId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '通信を確認してください。'); }
    finally { serial.current=false; setBusy(false); }
  }
  function switchConversation(id: string) {
    followLatest.current=true; generation.current++; retry.current=null; setRetryPending(false); setJobs([]); setConversationId(id); setError(''); setSelection(null); setMessage('');
    const ids=[id,...older.filter((value) => value!==id)].slice(0,20); setOlder(ids);
    try { localStorage.setItem('bentan-codex-conversations',JSON.stringify(ids)); } catch {}
  }
  if (!authorized) return null;
  const current = jobs.find(active);
  return <div data-codex-panel>
    {picking ? <div className={styles.pickNotice}>直したい場所をクリックしてください <button onClick={() => {setPicking(false);setOpen(true);}}>選択をやめる</button></div>
      : !open ? <button className={styles.launcher} onClick={() => {setOpen(true); if (!older.length) switchConversation(conversationId);}}>✦ Codexに修正を依頼</button> : null}
    {open && !picking && <aside ref={panel} className={styles.panel} aria-label="Codexに修正を依頼">
      <header className={styles.header}><div><strong>✦ Codexに修正を依頼</strong><small>{online ? 'PCに接続中' : 'PCの接続待ち・依頼は保存できます'}</small></div><button aria-label="チャットを閉じる" onClick={() => setOpen(false)}>×</button></header>
      <div className={styles.toolbar}><button disabled={busy || retryPending} onClick={() => switchConversation(crypto.randomUUID())}>新しい会話</button>
        <select aria-label="会話を切り替え" value={conversationId} disabled={busy || retryPending} onChange={(e) => switchConversation(e.target.value)}>{[...new Set([conversationId,...older])].filter(Boolean).map((id,i) => <option key={id} value={id}>会話 {id.slice(0,6)}{i===0?'（最新）':''}</option>)}</select></div>
      <div ref={history} className={styles.history} aria-label="会話履歴" aria-live="polite" aria-relevant="additions text" onScroll={(event) => {
        const container = event.currentTarget;
        followLatest.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
      }}>
        {!jobs.length && <p className={styles.empty}>見ているページの修正を依頼できます。<br/>「場所を選ぶ」で対象を指定し、変更したい内容を送ってください。</p>}
        {jobs.map((job) => <article className={styles.exchange} key={job.id}><div className={styles.user}><small>{job.page_context.path}</small><p>{job.message}</p>{job.page_context.selection && <blockquote>{job.page_context.selection}</blockquote>}</div>
          <div className={styles.answer}><small>{labels[job.status] || job.status}</small><p>{job.response || job.progress}</p>{job.response && active(job) && <small>{job.progress}</small>}
          {job.status==='awaiting_approval' && job.approval && <div className={styles.approval}><p>{job.approval.message}</p><button disabled={busy || job.cancel_requested} onClick={() => void mutate({action:'approve',conversationId,id:job.id,approvalId:job.approval!.id,decision:'accept'})}>この操作を許可</button><button disabled={busy || job.cancel_requested} onClick={() => void mutate({action:'approve',conversationId,id:job.id,approvalId:job.approval!.id,decision:'decline'})}>許可しない</button></div>}
          {active(job) && <button disabled={busy || job.cancel_requested} onClick={() => void mutate({action:'cancel',conversationId,id:job.id})}>{job.cancel_requested?'停止を依頼しました':'作業を停止'}</button>}</div></article>)}
      </div>
      <form className={styles.composer} onSubmit={(event) => {
        event.preventDefault(); if (!message.trim() || current || busy) return;
        const context = selection || {path:window.location.pathname,title:document.title.slice(0,150),selection:'',element:''};
        retry.current ||= {action:'send',id:crypto.randomUUID(),conversationId,message,context};
        try { localStorage.setItem('bentan-codex-conversations',JSON.stringify([conversationId,...older.filter(id=>id!==conversationId)].slice(0,20))); } catch {}
        setRetryPending(true); void mutate(retry.current);
      }}>
        <div className={styles.context}><button type="button" disabled={busy || retryPending} onClick={() => setPicking(true)}>⌖ 場所を選ぶ</button><span>{selection ? `選択済み：${selection.path}` : pathname}</span></div>
        {selection && <div className={styles.selected}><span>{selection.selection || selection.element}</span><button type="button" disabled={retryPending} onClick={() => setSelection(null)}>解除</button></div>}
        <label className={styles.inputLabel} htmlFor="codex-instruction">修正したい内容・質問</label>
        <textarea ref={input} id="codex-instruction" rows={3} maxLength={2000} value={message} readOnly={retryPending} onChange={(event) => setMessage(event.target.value)} placeholder="このボタンを大きくしてほしい"/>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.sendRow}><small>{current?'処理が終わったら続けて送れます':'ページと選択箇所を一緒に共有します'}</small><button type="submit" disabled={busy || !!current || !message.trim()}>{busy?'送信中…':retryPending?'同じ依頼を再送':'送信'}</button></div>
        {jobs.some(job=>job.status==='completed') && <button type="button" className={styles.reload} onClick={() => window.location.reload()}>ページを再読み込みして確認</button>}
      </form>
    </aside>}
  </div>;
}
