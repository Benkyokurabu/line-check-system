"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { getJapanDate } from "@/lib/reservation-date.mjs";
import styles from "./staff-study-room.module.css";

type Staff = { staffId: string; displayName: string };
type Status = "pending" | "approved" | "rejected" | "cancelled";
type Reservation = { id: string; student_number: string; student_name: string; grade: string;
  reservation_date: string; seat: number; slot_ids: string[]; status: Status; version: number;
  request_kind: string; intake_channel: string };
type Action = "approve" | "reject" | "cancel";
type Operation = { operationKey: string; requestId: string; expectedVersion: number; action: Action; reason: string };
const statusLabels: Record<Status, string> = { pending: "承認待ち", approved: "確定", rejected: "却下", cancelled: "取消済み" };
const actionLabels: Record<Action, string> = { approve: "承認して確定", reject: "却下", cancel: "予約を取り消す" };
const preferenceKey = (staffId: string) => `bentan:staff:${staffId}:study-room-status`;
function rememberedStatus(staffId: string) {
  try { const value = localStorage.getItem(preferenceKey(staffId)) ?? ""; return value in statusLabels ? value : ""; }
  catch { return ""; }
}

export default function StaffStudyRoom() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [date, setDate] = useState(getJapanDate());
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<{ row: Reservation; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [retry, setRetry] = useState<Operation | null>(null);

  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) { setStaff(null); setRows([]); setPermissions({}); setSelected(null); setRetry(null); }
      throw Object.assign(new Error(data.error ?? "処理に失敗しました。"), { status: response.status });
    }
    return data;
  }
  async function load(targetDate: string, targetStatus: string, targetOffset: number) {
    const params = new URLSearchParams({ date: targetDate, offset: String(targetOffset) });
    if (targetStatus) params.set("status", targetStatus);
    const data = await request(`/api/staff/study-room/requests?${params}`);
    setRows(data.requests); setMore(data.hasMore); setPermissions(data.permissions); setOffset(targetOffset);
  }
  async function work(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "通信に失敗しました。再度確認してください。"); }
    finally { running.current = false; setBusy(false); setChecked(true); }
  }
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch("/api/staff/session", { cache: "no-store", credentials: "same-origin" });
        const data = await response.json();
        if (disposed) return;
        if (response.ok) { setStaff(data.staff); setStatus(rememberedStatus(data.staff.staffId)); }
        else if (response.status !== 401) setMessage(data.error ?? "職員認証を利用できません。");
      } catch { if (!disposed) setMessage("接続できません。通信状態を確認してください。"); }
      finally { if (!disposed) setChecked(true); }
    })();
    return () => { disposed = true; };
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    await work(async () => {
      const secret = password; setPassword(""); setMessage("");
      const data = await request("/api/staff/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffCode: code, password: secret }) });
      setStaff(data.staff); setStatus(rememberedStatus(data.staff.staffId)); setRows([]); setMessage("ログインしました。対象日を選び「一覧を更新」を押してください。");
    });
  }
  async function logout() {
    await work(async () => {
      setStaff(null); setRows([]); setPermissions({}); setSelected(null); setRetry(null); setPassword("");
      try { await request("/api/staff/session", { method: "DELETE" }); setMessage("ログアウトしました。"); }
      catch { setMessage("この画面の情報を消しましたが、サーバー側のログアウトを確認できませんでした。管理者に確認してください。"); }
    });
  }
  async function apply(operation: Operation) {
    await work(async () => {
      setRetry(operation); setMessage("");
      try {
        await request("/api/staff/study-room/transition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) });
      } catch (error) {
        const statusCode = (error as { status?: number }).status;
        if (statusCode && statusCode < 500) {
          setRetry(null); setSelected(null);
          if (statusCode === 409) { setRows([]); await load(date, status, 0); }
          throw error;
        }
        setMessage("処理結果を確認できません。同じ操作の「結果を再確認」を押してください。重複した予約確定は行いません。");
        return;
      }
      setRetry(null); setSelected(null); setRows([]);
      setMessage("処理を保存しました。通知の送信完了を意味するものではありません。");
      await load(date, status, 0);
    });
  }
  const frozen = busy || !!retry;
  return <main className={`shell ${styles.screen}`}><section className="panel">
    <p className="eyebrow">職員用</p><h1>自習室の申請管理</h1>
    <p>申請を確認して承認すると予約が確定します。承認時にも空席を再確認します。</p>
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {!checked ? <p role="status">ログイン状態を確認しています…</p> : !staff ?
      <form onSubmit={login} className={styles.form}>
        <label className={styles.field}>職員コード<input autoComplete="username" required maxLength={64} value={code} onChange={e => setCode(e.target.value)} disabled={busy} /></label>
        <label className={styles.field}>パスワード<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <button className={styles.primary} disabled={busy}>ログイン</button>
      </form> : <>
        <div className={styles.toolbar}><p>{staff.displayName} さん</p><button onClick={logout} disabled={busy}>ログアウト</button></div>
        <p>共有端末では、離席する前にログアウトしてください。未到着を理由に自動取消・自動連絡は行いません。</p>
        <div className={styles.toolbar}>
          <label className={styles.field}>対象日<input type="date" value={date} disabled={frozen} onChange={e => { setDate(e.target.value); setRows([]); setOffset(0); setMore(false); setSelected(null); }} /></label>
          <label className={styles.field}>状態<select value={status} disabled={frozen} onChange={e => {
            setStatus(e.target.value); setRows([]); setOffset(0); setMore(false); setSelected(null);
            try { localStorage.setItem(preferenceKey(staff.staffId), e.target.value); }
            catch { setMessage("この端末では表示条件を記憶できません。今回の選択はそのまま使えます。"); }
          }}>
            <option value="">すべて</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button disabled={frozen || !date} onClick={() => work(async () => { setMessage(""); setSelected(null); setRows([]); await load(date, status, 0); })}>一覧を更新</button>
        </div>
        {retry && <div className={styles.notice}><p>結果が未確認の操作があります。</p><button disabled={busy} onClick={() => apply(retry)}>結果を再確認</button></div>}
        {busy && <p role="status">処理中です…</p>}
        <div className={styles.cards}>{rows.map(row => <article className={styles.card} key={row.id}>
          <span className={styles.status}>{statusLabels[row.status]}</span>
          <h2>{row.student_name} <small>（{row.grade}・{row.student_number}）</small></h2>
          <p>{row.reservation_date} ／ {row.seat}番席<br />{row.slot_ids.join("、")}</p>
          <p>{row.request_kind === "same_day" ? "当日申請" : "事前申請"} ／ {row.intake_channel === "line_screen" ? "LINE予約画面" : row.intake_channel === "line_message" ? "LINE個別連絡" : "職員代理入力"}</p>
          <div className={styles.actions}>
            {(["approve", "reject", "cancel"] as Action[]).filter(action => action === "cancel"
              ? ["pending", "approved"].includes(row.status) && permissions["study_room.cancel"]
              : row.status === "pending" && permissions["study_room.approve"]).map(action =>
              <button key={action} className={action === "approve" ? styles.primary : undefined} disabled={frozen} onClick={() => { setSelected({ row, action }); setReason(""); }}>{actionLabels[action]}</button>)}
          </div>
          {selected?.row.id === row.id && !retry && <form className={styles.confirm} onSubmit={e => { e.preventDefault(); void apply({ operationKey: crypto.randomUUID(), requestId: row.id, expectedVersion: row.version, action: selected.action, reason }); }}>
            <p>{row.student_name} さんの上記の申請を「{actionLabels[selected.action]}」します。</p>
            <label className={styles.field}>理由{selected.action === "reject" ? "（必須）" : "（任意）"}<textarea maxLength={2000} required={selected.action === "reject"} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
            <div className={styles.actions}><button disabled={busy} className={styles.primary}>内容を確認して実行</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>戻る</button></div>
          </form>}
        </article>)}</div>
        {!busy && rows.length === 0 && <p>表示中の申請はありません。「一覧を更新」で最新の状態を確認できます。</p>}
        <div className={styles.actions}><button disabled={frozen || offset === 0} onClick={() => work(async () => { setSelected(null); await load(date, status, Math.max(0, offset - 50)); })}>前の50件</button>
          <button disabled={frozen || !more} onClick={() => work(async () => { setSelected(null); await load(date, status, offset + 50); })}>次の50件</button></div>
        <p>申請の追加・変更後は「一覧を更新」で先頭から確認してください。</p>
      </>}
  </section></main>;
}
