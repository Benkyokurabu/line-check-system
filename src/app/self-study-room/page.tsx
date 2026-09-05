"use client";

import { useEffect, useMemo, useState } from "react";
import { getJapanDate } from "@/lib/reservation-date.mjs";

const slots = [
  { id: "14:55-16:25", label: "14:55–16:25" },
  { id: "16:45-18:15", label: "16:45–18:15" },
  { id: "18:35-20:05", label: "18:35–20:05" },
  { id: "20:25-21:55", label: "20:25–21:55" },
];
type Reservation = { id: string; slot_id: string; start_time: string; end_time: string; seat: number; student_number: string; grade: string; student_name: string };
type Availability = { seats: number[]; reservations: Reservation[]; closedSlotIds: string[]; limitMinutes: number; studentMinutes: number };

export default function SelfStudyRoomPage() {
  const today = getJapanDate();
  const [date, setDate] = useState(today);
  const [studentNumber, setStudentNumber] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selected, setSelected] = useState<{ seat: number; slotId: string }[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/self-study-room?date=${encodeURIComponent(date)}&studentNumber=${encodeURIComponent(studentNumber)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "取得に失敗しました。");
      setAvailability(data);
      setSelected((current) => current.filter(({ seat, slotId }) => !data.reservations.some((item: Reservation) => item.seat === seat && item.slot_id === slotId) && !data.closedSlotIds.includes(slotId)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "取得に失敗しました。"); }
    finally { setLoading(false); }
  }
  // The effect refreshes data whenever the selected date or student changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [date, studentNumber]);

  const selectedMinutes = selected.length * 90;
  const limitText = availability?.limitMinutes ? `本日の上限：${availability.limitMinutes / 90}枠（予約済み ${availability.studentMinutes / 90}枠）` : "本日の予約制限はありません。";
  const selectedText = useMemo(() => selected.map(({ seat, slotId }) => `${slots.find((slot) => slot.id === slotId)?.label} / ${seat}番席`).join("、"), [selected]);
  function toggle(seat: number, slotId: string) {
    setSelected((current) => current.some((item) => item.seat === seat && item.slotId === slotId) ? current.filter((item) => !(item.seat === seat && item.slotId === slotId)) : [...current.filter((item) => item.slotId !== slotId), { seat, slotId }]);
  }
  async function reserve() {
    if (!studentNumber.trim()) return setMessage("学籍番号を入力してください。");
    if (!selected.length) return setMessage("空き枠を選択してください。");
    if (availability?.limitMinutes && availability.studentMinutes + selectedMinutes > availability.limitMinutes) return setMessage("本日の予約上限を超えています。");
    if (!window.confirm(`次の予約を確定しますか？\n${selectedText}`)) return;
    setLoading(true);
    try {
      const groups = new Map<number, string[]>();
      for (const item of selected) groups.set(item.seat, [...(groups.get(item.seat) ?? []), item.slotId]);
      for (const [seat, slotIds] of groups) {
        const response = await fetch("/api/self-study-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, studentNumber: studentNumber.trim(), seat, slotIds }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "予約に失敗しました。");
      }
      setSelected([]); setMessage("予約しました。"); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "予約に失敗しました。"); }
    finally { setLoading(false); }
  }
  async function cancel(id: string) {
    if (!window.confirm("この予約をキャンセルしますか？")) return;
    setLoading(true);
    try {
      const response = await fetch("/api/self-study-room/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, studentNumber: studentNumber.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "キャンセルに失敗しました。");
      setMessage("キャンセルしました。"); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "キャンセルに失敗しました。"); }
    finally { setLoading(false); }
  }
  const myReservations = availability?.reservations.filter((item) => item.student_number === studentNumber.trim()) ?? [];
  return <main className="shell"><section className="panel">
    <p className="eyebrow">SELF STUDY ROOM</p><h1>自習室予約</h1>
    <p>利用ルールを確認したうえで、学籍番号・日付・座席を選択してください。</p>
    <div style={{ display: "grid", gap: 12, marginTop: 24, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      <label>利用日<input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }} /></label>
      <label>学籍番号<input inputMode="numeric" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value)} placeholder="例：2018001" style={{ display: "block", width: "100%", padding: 10, marginTop: 6 }} /></label>
    </div>
    <p style={{ marginTop: 16 }}>{limitText}</p>
    {message && <p role="status" style={{ marginTop: 12, color: "#b42318", fontWeight: 700 }}>{message}</p>}
    {loading && <p style={{ marginTop: 16 }}>読み込み中…</p>}
    {availability && <div style={{ overflowX: "auto", marginTop: 20 }}><table><thead><tr><th>座席</th>{slots.map((slot) => <th key={slot.id}>{slot.label}</th>)}</tr></thead><tbody>{availability.seats.map((seat) => <tr key={seat}><th>{seat}番</th>{slots.map((slot) => { const reservation = availability.reservations.find((item) => item.seat === seat && item.slot_id === slot.id); const closed = availability.closedSlotIds.includes(slot.id); const isSelected = selected.some((item) => item.seat === seat && item.slotId === slot.id); return <td key={slot.id}>{reservation ? <span>{reservation.grade} {reservation.student_name}</span> : closed ? <span>使用不可</span> : <button type="button" onClick={() => toggle(seat, slot.id)} style={{ padding: "10px 14px", border: "1px solid #06c755", background: isSelected ? "#d8f8e5" : "#fff", borderRadius: 6 }}>{isSelected ? "選択中" : "空き"}</button>}</td>; })}</tr>)}</tbody></table></div>}
    <button type="button" onClick={reserve} disabled={loading || !selected.length} style={{ marginTop: 20, padding: "12px 18px", fontWeight: 700 }}>選択した枠を予約する</button>
    {selected.length > 0 && <p style={{ marginTop: 12 }}>選択中：{selectedText}</p>}
    {studentNumber.trim() && <div style={{ marginTop: 28 }}><h2 style={{ fontSize: "1.2rem", marginBottom: 10 }}>この日の予約</h2>{myReservations.length ? myReservations.map((item) => <p key={item.id} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>{item.start_time}–{item.end_time} / {item.seat}番席 <button type="button" onClick={() => cancel(item.id)} disabled={loading}>キャンセル</button></p>) : <p>予約はありません。</p>}</div>}
  </section></main>;
}
