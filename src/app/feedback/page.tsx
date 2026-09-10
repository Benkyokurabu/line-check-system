"use client";

import { useRef, useState, type FormEvent } from "react";
const field = { display: "grid", gap: 8, fontWeight: 700 } as const;
const input = { width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid var(--line)", borderRadius: 8, font: "inherit" } as const;
const button = { padding: "12px 24px", border: 0, borderRadius: 8, background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
export default function FeedbackPage() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<{ id: string; name: string; message: string } | null>(null);
  const running = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (!operation.current || operation.current.name !== name.trim() || operation.current.message !== message.trim()) operation.current = { id: crypto.randomUUID(), name: name.trim(), message: message.trim() };
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
    {sent ? <section className="panel" style={{ padding: 24 }}><h2 role="status">送信しました</h2><p>ご意見ありがとうございます。</p><button type="button" style={button} onClick={() => setSent(false)}>別の内容を送る</button></section> : <form onSubmit={submit}>
      <fieldset disabled={busy} className="panel" style={{ display: "grid", gap: 20, padding: 24, minWidth: 0 }}>
        <label style={field}>名前<input style={input} required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div style={field}><label htmlFor="feedback-message">内容</label><textarea id="feedback-message" style={{ ...input, resize: "vertical", minHeight: 200 }} required maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="気づいたことを自由にご記入ください。" /></div>
        <small>{message.length} / 2000文字</small><button style={button} type="submit" disabled={busy || !name.trim() || !message.trim()}>{busy ? "送信中…" : "送信する"}</button>
      </fieldset>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    </form>}
  </main>;
}
