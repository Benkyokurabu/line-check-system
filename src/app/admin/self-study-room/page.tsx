"use client";

import { useEffect, useState } from "react";

const slots = ["14:55-16:25", "16:45-18:15", "18:35-20:05", "20:25-21:55"];
type Reservation = { id: string; start_time: string; end_time: string; seat: number; student_number: string; grade: string; student_name: string };

export default function SelfStudyRoomAdminPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch(`/api/admin/self-study-room?date=${date}`); const data = await response.json(); if (!response.ok) return setMessage(data.error ?? "取得に失敗しました。"); setLimit(data.limitMinutes); setClosed(data.closedSlotIds ?? []); setReservations(data.reservations ?? []); }
  // The effect refreshes the selected day's management data.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [date]);
  async function save() { const response = await fetch("/api/admin/self-study-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, limitMinutes: limit, closedSlotIds: closed }) }); const data = await response.json(); setMessage(response.ok ? "保存しました。" : data.error ?? "保存に失敗しました。"); if (response.ok) await load(); }
  async function cancel(id: string) { if (!window.confirm("この予約をキャンセルしますか？")) return; await fetch("/api/admin/self-study-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancelId: id }) }); await load(); }
  return <main className="shell"><section className="panel"><p className="eyebrow">SELF STUDY ROOM ADMIN</p><h1>自習室管理</h1><label>対象日<input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ display: "block", padding: 10, marginTop: 6 }} /></label><div style={{ marginTop: 20 }}><label>1人あたりの上限<select value={limit} onChange={(event) => setLimit(Number(event.target.value))} style={{ display: "block", padding: 10, marginTop: 6 }}><option value={0}>無制限</option><option value={90}>1枠</option><option value={180}>2枠</option><option value={270}>3枠</option></select></label><p style={{ marginTop: 16 }}>使用不可時間帯</p>{slots.map((slot) => <label key={slot} style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={closed.includes(slot)} onChange={(event) => setClosed((current) => event.target.checked ? [...current, slot] : current.filter((item) => item !== slot))} /> {slot}</label>)}<button type="button" onClick={save} style={{ marginTop: 16, padding: "10px 16px" }}>設定を保存</button></div>{message && <p role="status" style={{ marginTop: 12 }}>{message}</p>}<h2 style={{ marginTop: 28 }}>予約一覧（{reservations.length}件）</h2>{reservations.map((item) => <p key={item.id} style={{ marginTop: 10 }}>{item.start_time}–{item.end_time} / {item.seat}番席 / {item.student_number} {item.grade} {item.student_name} <button type="button" onClick={() => cancel(item.id)} style={{ marginLeft: 8 }}>キャンセル</button></p>)}</section></main>;
}
