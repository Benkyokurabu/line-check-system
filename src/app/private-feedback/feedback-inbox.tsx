"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Feedback = { id: string; sender_name: string; message: string; created_at: string; reviewed_at?:string|null; notification_status?:string|null; sharing_preference?:'anonymous'|'named'|'unspecified' };
const button = { padding: "10px 16px", border: "1px solid var(--line)", borderRadius: 6, background: "white", cursor: "pointer", fontWeight: 700 } as const;
export default function FeedbackInbox() {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [unreviewed, setUnreviewed] = useState(0);
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [notificationIssue, setNotificationIssue] = useState(false);
  const running = useRef(false);
  const sequence = useRef(0);
  const load = useCallback(async (nextOffset = 0, signal?: AbortSignal, filter = onlyUnreviewed) => {
    const current = ++sequence.current;
    const response = await fetch(`/api/private-feedback?offset=${nextOffset}&unreviewed=${filter}`, { cache: "no-store", signal });
    const body = await response.json();
    if (current !== sequence.current || signal?.aborted) return;
    if (!response.ok) {
      setRows([]); setAuthorized(false);
      if (response.status === 401) { setError(""); return; }
      throw new Error(response.status === 403 ? "このページは工藤専用です。工藤のアカウントでログインしてください。" : body.error ?? "一覧を取得できませんでした。");
    }
    setRows(body.feedback); setAuthorized(true); setOffset(nextOffset); setHasMore(body.hasMore); setError("");
    setUnreviewed(body.unreviewedCount ?? body.feedback.filter((row:Feedback)=>!row.reviewed_at).length);
    setNotificationIssue((body.notificationBlocked ?? 0) > 0);
  }, [onlyUnreviewed]);
  useEffect(() => {
    const controller = new AbortController();
    // Load only after the server verifies the staff session and reader grant.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0, controller.signal).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "通信を確認してください。"); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!authorized) return;
    const controller = new AbortController();
    const refresh = () => { if (!running.current && document.visibilityState === "visible") void load(offset, controller.signal).catch(() => { if (!controller.signal.aborted) setError("最新のご意見を取得できませんでした。更新してください。"); }); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [authorized, load, offset]);
  async function work(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try { await task(); }
    catch (cause) { setRows([]); setAuthorized(false); setError(cause instanceof Error ? cause.message : "通信を確認してください。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    await work(async () => {
      const response = await fetch("/api/staff/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffCode: "KUDO", password }) });
      const body = await response.json();
      setPassword("");
      if (!response.ok) throw new Error(body.error ?? "ログインできませんでした。");
      await load();
    });
  }
  return <main className="shell" style={{ maxWidth: 860 }}>
    <h1>改善要望の確認</h1><p>工藤専用。投稿内容と紹介時の名前の扱いを確認できます。</p>
    {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    {!authorized ? <form onSubmit={login} className="panel" style={{ padding: 24, display: "grid", gap: 12 }}>
      <label>工藤のパスワード<input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 12, marginTop: 8 }} /></label>
      <button style={button} disabled={busy || !password} type="submit">{busy ? "確認中…" : "ログイン"}</button>
    </form> : <>
      <p role="status" style={{fontWeight:700}}>未確認 {unreviewed}件</p>
      {notificationIssue && <p role="alert">LINE通知が送れなかった要望があります。内容はこの一覧で確認できます。</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}} aria-label="表示する要望">
        <button style={button} aria-pressed={onlyUnreviewed} disabled={busy} onClick={()=>{setOnlyUnreviewed(true);}}>未確認のみ</button>
        <button style={button} aria-pressed={!onlyUnreviewed} disabled={busy} onClick={()=>{setOnlyUnreviewed(false);}}>すべて</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={button} disabled={busy} onClick={() => void work(() => load(0))}>最新の内容に更新</button>
        <button style={button} disabled={busy} onClick={() => void work(async () => {
          setRows([]); setAuthorized(false);
          const response = await fetch("/api/staff/session", { method: "DELETE" });
          if (!response.ok) throw new Error("ログアウトを確認できませんでした。再度ログインしてログアウトしてください。");
        })}>ログアウト</button>
      </div>
      {!rows.length && <p>{onlyUnreviewed?'未確認の改善要望はありません。':'届いたご意見はまだありません。'}</p>}
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>{rows.map((row) => <article className="panel" key={row.id} style={{ padding: 20, overflowWrap: "anywhere" }}>
        <strong>{row.sender_name}</strong><p style={{ color: "var(--muted)", fontSize: 13 }}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}</p>
        <p style={{padding:'10px 12px',borderRadius:8,background:row.sharing_preference==='named'?'#e8f5ed':'#fff3d2',fontWeight:700}}>{row.sharing_preference==='anonymous'?'匿名希望：他の職員へ紹介するときは名前を出さない':row.sharing_preference==='named'?'名前を出して紹介してもよい':'紹介時の名前の扱い：未確認'}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{row.message}</p>
        {row.reviewed_at ? <p style={{color:'var(--muted)'}}>確認済み</p> : <button style={button} disabled={busy} onClick={()=>void work(async()=>{
          const response=await fetch('/api/private-feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});
          if(!response.ok){if(response.status===401||response.status===403){setRows([]);setAuthorized(false);}throw new Error('確認済みの保存を確認できませんでした。再度お試しください。');}
          await load(0);
        })}>確認済みにする</button>}
        {row.notification_status&&<p style={{fontSize:12,color:'var(--muted)',marginTop:12}}>{row.notification_status==='sent'?'LINE通知済み':row.notification_status==='blocked'?'LINE通知を送れませんでした':'LINE通知待ち'}</p>}
      </article>)}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}><button style={button} disabled={busy || offset === 0} onClick={() => void work(() => load(Math.max(0, offset - 50)))}>前の50件</button><button style={button} disabled={busy || !hasMore} onClick={() => void work(() => load(offset + 50))}>次の50件</button></div>
    </>}
  </main>;
}
