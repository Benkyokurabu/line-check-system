"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import StaffLogin from "@/components/staff-login";

type Reader = { readerId: string; name: string; confirmedAt: string | null; version?: number };
type Item = { id: string; title: string; body: string; source_url: string; source_hash: string; source_edited_at: string | null; version: number; confirmed: boolean; readers: Reader[]; history: Reader[] };
type Payload = { staff: { staffId: string; displayName: string; staffCode: string; readerId: string; role: string; trialOnly: boolean }; items: Item[]; unreadCount: number; hasMore: boolean; sync?: { trial_only: boolean; last_sync_at: string | null; sync_status: string } };
const panel: CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", padding: "clamp(16px, 3vw, 24px)", marginBottom: 20, overflowWrap: "anywhere" };
const actions: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const button: CSSProperties = { display: "inline-flex", justifyContent: "center", alignItems: "center", minHeight: 44, padding: "10px 16px", borderWidth: 1, borderStyle: "solid", borderColor: "var(--line)", borderRadius: 8, background: "white", color: "var(--foreground)", fontSize: 14, fontWeight: 700, textAlign: "center", cursor: "pointer" };
const primary: CSSProperties = { ...button, background: "var(--accent)", color: "white", borderColor: "var(--accent)" };
function when(value: string | null | undefined) {
  if (!value) return "日時不明";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(date) : "日時不明";
}
function notionUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["www.notion.so", "notion.so", "app.notion.com"].includes(url.hostname) ? url.href : null; } catch { return null; }
}

export default function BenkeiHome({ fullPage = false }: { fullPage?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [access, setAccess] = useState<"loading" | "ready" | "login" | "denied" | "error">("loading");
  const [all, setAll] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const generation = useRef(0), mutationLock = useRef(false);
  const refresh = useCallback(async (append = false, offset = 0) => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/staff/benkei?all=${all ? 1 : 0}&offset=${offset}`, { cache: "no-store" });
      if (request !== generation.current) return;
      if (response.status === 401 || response.status === 403) { setData(null); setAccess(response.status === 401 ? "login" : "denied"); return; }
      if (!response.ok) throw new Error("ベンケイを読み込めませんでした。再読み込みしてください。");
      const body = await response.json() as Payload;
      if (request !== generation.current) return;
      if (!Array.isArray(body.items) || !body.staff || typeof body.unreadCount !== "number") throw new Error("ベンケイを読み込めませんでした。");
      setData(previous => append && previous ? { ...body, items: [...new Map([...previous.items, ...body.items].map(item => [item.id, item])).values()] } : body);
      setAccess("ready"); setError("");
    } catch (caught) { if (request === generation.current) { setError((caught as Error).message); setData(null); setAccess("error"); } }
    finally { if (request === generation.current) setLoading(false); }
  }, [all]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const focus = () => { if (document.visibilityState === "visible" && !mutationLock.current) void refresh(); };
    const timer = setInterval(focus, 60000);
    window.addEventListener("focus", focus); window.addEventListener("bentan:staff-session-active", focus);
    return () => { generation.current += 1; clearTimeout(initial); clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("bentan:staff-session-active", focus); };
  }, [refresh]);

  async function mutate(item?: Item) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(item?.id ?? "sync"); setError(""); setNotice("");
    // Discard an older GET result which could restore an already confirmed row.
    generation.current += 1;
    try {
      const response = await fetch("/api/staff/benkei", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item ? { action: "confirm", itemId: item.id, version: item.version, sourceHash: item.source_hash } : { action: "sync" }) });
      if (response.status === 401 || response.status === 403) { setData(null); setAccess(response.status === 401 ? "login" : "denied"); return; }
      if (response.status === 409) { await refresh(); setError("内容が更新されました。最新の本文を読み直してから確認してください。"); return; }
      if (!response.ok) throw new Error(item ? "確認を保存できませんでした。確認状態を再読み込みしてからお試しください。" : "Notionとの同期に失敗しました。時間をおいて再度お試しください。");
      await refresh();
      setNotice(item ? "確認を保存しました。確認者一覧に記録されています。" : "Notionの最新内容を取得しました。");
    } catch (caught) { setError((caught as Error).message); }
    finally { mutationLock.current = false; setBusy(null); }
  }

  if (!fullPage && ["loading", "login", "denied"].includes(access)) return null;
  if (access === "login") return <StaffLogin onLogin={() => { void refresh(); }} />;
  if (access === "denied") return <section style={panel}><h2>ベンケイ</h2><p>このアカウントではベンケイを利用できません。</p><Link href="/" style={{ ...button, marginTop: 12 }}>ホームへ戻る</Link></section>;
  if (access === "loading") return <p role="status">ベンケイを読み込み中…</p>;
  return <section style={panel} aria-label="ベンケイの確認">
    <div style={{ ...actions, justifyContent: "space-between", marginBottom: 12 }}>
      <div><h2 style={{ fontSize: 20, marginBottom: 6 }}>ベンケイ</h2><p>{data ? `${data.staff.displayName}さんの未確認 ${data.unreadCount}件` : "共有事項を確認する"}</p></div>
      {!fullPage && <Link href="/staff/benkei" prefetch={false} style={button}>全件・確認者を見る</Link>}
    </div>
    {data?.staff.trialOnly && <p style={{ fontSize: 13, marginBottom: 12 }}>操作確認中：現在は利用対象を限定しています。</p>}
    {fullPage && <p style={{ marginBottom: 14 }}>本文を読んで「読んで確認した」を押すと、自分の未確認一覧から消えます。内容が改訂された場合は、もう一度確認してください。</p>}
    {fullPage && <div style={{ ...actions, marginBottom: 16 }} role="group" aria-label="表示するベンケイ">
      <button type="button" style={all ? button : primary} aria-pressed={!all} disabled={!!busy} onClick={() => { setAll(false); setNotice(""); }}>自分の未確認</button>
      <button type="button" style={all ? primary : button} aria-pressed={all} disabled={!!busy} onClick={() => { setAll(true); setNotice(""); }}>全件・確認者</button>
    </div>}
    {error && <p role="alert" style={{ color: "#a32626", marginBottom: 12 }}>{error}</p>}
    <p role="status" aria-live="polite" style={{ marginBottom: notice ? 12 : 0 }}>{notice}</p>
    {data && !data.items.length && <p style={{ padding: "12px 0" }}>{all ? "共有事項はまだありません。" : "未確認のベンケイはありません。"}</p>}
    <div style={{ display: "grid", gap: 16 }}>
      {data?.items.map(item => {
        const readers = item.readers ?? [], history = item.history ?? [];
        const confirmed = readers.filter(reader => reader.confirmedAt), url = notionUrl(item.source_url);
        return <article key={item.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16, minWidth: 0 }}>
          <div style={{ ...actions, justifyContent: "space-between", marginBottom: 6 }}><h3 style={{ fontSize: 17 }}>{item.title}</h3><span style={{ color: item.confirmed ? "var(--accent)" : "#9b5b08", fontSize: 13, fontWeight: 700 }}>{item.confirmed ? "自分は確認済み" : item.version > 1 ? "改訂・再確認が必要" : "未確認"}</span></div>
          <p style={{ fontSize: 12, marginBottom: 12 }}>第{item.version}版 ・ 更新 {when(item.source_edited_at)}</p>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.85, marginBottom: 16 }}>{item.body || "本文がありません。原文をご確認ください。"}</div>
          <div style={actions}>
            {!item.confirmed && <button type="button" style={primary} disabled={!!busy || loading} onClick={() => void mutate(item)}>{busy === item.id ? "保存中…" : "読んで確認した"}</button>}
            {url && <a href={url} target="_blank" rel="noopener noreferrer" style={button}>Notionの原文を開く ↗</a>}
          </div>
          <details style={{ marginTop: 16 }}><summary style={{ cursor: "pointer", minHeight: 36, padding: "8px 0", fontSize: 14, fontWeight: 700 }}>確認者 {confirmed.length} / {readers.length}人</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{readers.map(reader => <p key={reader.readerId} style={{ fontSize: 13 }}>{reader.name}：{reader.confirmedAt ? `確認済み ${when(reader.confirmedAt)}` : "未確認"}</p>)}</div>
            {history.some(receipt => receipt.version !== item.version) && <details style={{ marginTop: 10 }}><summary style={{ cursor: "pointer", padding: "8px 0", fontSize: 13 }}>過去の版の確認履歴</summary>{history.filter(receipt => receipt.version !== item.version).map((receipt, index) => <p key={`${receipt.readerId}-${receipt.version}-${index}`} style={{ fontSize: 12 }}>第{receipt.version}版 ・ {receipt.name} ・ {when(receipt.confirmedAt)}</p>)}</details>}
          </details>
        </article>;
      })}
    </div>
    <div style={{ ...actions, marginTop: 16 }}>
      {data?.hasMore && <button type="button" style={button} disabled={loading || !!busy} onClick={() => void refresh(true, data.items.length)}>{loading ? "読み込み中…" : "続きを表示"}</button>}
      <button type="button" style={button} disabled={loading || !!busy} onClick={() => void refresh()}>{loading ? "読み込み中…" : "確認状態を再読み込み"}</button>
      {fullPage && data?.staff.staffCode === "KUDO" && <button type="button" style={button} disabled={loading || !!busy} onClick={() => void mutate()}>{busy === "sync" ? "同期中…" : "Notionの最新内容を取得"}</button>}
    </div>
    {fullPage && data?.sync && <p style={{ fontSize: 12, marginTop: 12 }}>最終取得：{when(data.sync.last_sync_at)}{data.sync.sync_status !== "ok" && " ・ 最新内容の取得を確認してください"}</p>}
  </section>;
}
