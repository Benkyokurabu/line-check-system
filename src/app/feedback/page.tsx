"use client";

import { useRef, useState, type FormEvent } from "react";
const field = { display: "grid", gap: 8, fontWeight: 700 } as const;
const input = { width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid var(--line)", borderRadius: 8, font: "inherit" } as const;
const button = { padding: "12px 24px", border: 0, borderRadius: 8, background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
export default function FeedbackPage() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sharingPreference,setSharingPreference]=useState<'anonymous'|'named'>('anonymous');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<{ id: string; name: string; message: string; sharingPreference:string } | null>(null);
  const running = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (!operation.current || operation.current.name !== name.trim() || operation.current.message !== message.trim() || operation.current.sharingPreference!==sharingPreference) operation.current = { id: crypto.randomUUID(), name: name.trim(), message: message.trim(),sharingPreference };
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.current) });
      const body = await response.json();
      if (!response.ok || body.accepted !== true) throw new Error(body.error ?? "送信を確認できませんでした。再試行してください。");
      setSent(true); setMessage(""); operation.current = null;
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "通信できませんでした。入力内容を残したまま再試行できます。"); }
    finally { running.current = false; setBusy(false); }
  }
  return <main className="shell" style={{ maxWidth: 720 }}>
    <p className="eyebrow">勉たんへのご意見</p><h1>改善してほしいことなど、何でも</h1>
    <p>使いにくいところ、追加してほしい機能、気づいたことなどをお寄せください。送信内容は工藤だけが確認します。</p>
    {sent ? <section className="panel" style={{ padding: 24 }}><h2 role="status">送信しました</h2><p>ご意見ありがとうございます。</p><p>{sharingPreference==='anonymous'?'「他の職員へは名前を出さずに紹介してほしい」という希望も伝えました。':'「他の職員へ名前を出して紹介してもよい」という希望も伝えました。'}</p><button type="button" style={button} onClick={() => setSent(false)}>別の内容を送る</button></section> : <form onSubmit={submit}>
      <fieldset disabled={busy} className="panel" style={{ display: "grid", gap: 20, padding: 24, minWidth: 0 }}>
        <label style={field}>名前<input style={input} required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <fieldset style={{border:'1px solid var(--line)',borderRadius:10,padding:16,minWidth:0}}>
          <legend style={{fontWeight:700,padding:'0 6px'}}>提案を他の職員へ紹介するとき</legend>
          <p style={{fontSize:14,margin:'4px 0 14px'}}>工藤には名前と内容が届きます。他の職員へ紹介する際の希望を選んでください。</p>
          {([{value:'anonymous',label:'名前を出さずに紹介してほしい',detail:'匿名の提案として扱ってほしい'},{value:'named',label:'名前を出してもよい',detail:'提案者の名前を添えて紹介してもよい'}] as const).map(option=><label key={option.value} style={{display:'flex',gap:10,alignItems:'flex-start',padding:14,marginTop:10,borderRadius:8,border:sharingPreference===option.value?'2px solid var(--accent)':'1px solid var(--line)',background:sharingPreference===option.value?'var(--accent-soft)':'white',cursor:'pointer'}}>
            <input type="radio" name="sharing-preference" value={option.value} checked={sharingPreference===option.value} onChange={()=>setSharingPreference(option.value)} style={{marginTop:4,flexShrink:0}}/>
            <span><strong>{option.label}</strong><small style={{display:'block',marginTop:5,fontWeight:400}}>{option.detail}</small></span>
          </label>)}
        </fieldset>
        <div style={field}><label htmlFor="feedback-message">内容</label><textarea id="feedback-message" style={{ ...input, resize: "vertical", minHeight: 200 }} required maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="気づいたことを自由にご記入ください。" /></div>
        <small>{message.length} / 2000文字</small><button style={button} type="submit" disabled={busy || !name.trim() || !message.trim()}>{busy ? "送信中…" : "送信する"}</button>
      </fieldset>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    </form>}
  </main>;
}
