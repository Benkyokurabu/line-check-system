"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useState } from "react";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null };
type Candidate = {
  id: string; student_number: string | null; suggested_student_name: string | null;
  event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null;
  ai_summary: string | null; ai_confidence: number | null; ai_reason: string | null;
  status: string; notion_error: string | null;
  student_roster: { student_name: string; grade: string; campus: string | null } | null;
  lessons: Lesson | null; line_messages: { text: string | null; received_at: string | null; display_name: string | null } | null;
};

const buttonStyle = { border: 0, borderRadius: 6, padding: "10px 14px", background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
const inputStyle = { width: "100%", padding: "9px", border: "1px solid var(--line)", borderRadius: 6, background: "white" } as const;

export default function AttendancePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [confirmedBy, setConfirmedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/attendance/candidates?status=pending");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "候補を取得できませんでした");
    setCandidates(body.candidates ?? []);
  }, []);
  useEffect(() => {
    async function initialize() {
      try {
        const [, studentBody] = await Promise.all([load(), fetch("/api/students").then((res) => res.json())]);
        setStudents(studentBody.students ?? []);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void initialize();
  }, [load]);

  async function analyze() {
    setBusy(true); setMessage("LINEを解析しています…");
    try {
      const response = await fetch("/api/attendance/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "解析に失敗しました");
      setMessage(`${body.processed}件を解析し、欠席候補${body.candidates}件を追加しました。対象外${body.ignored}件、失敗${body.failed}件です。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="shell" style={{ maxWidth: 1100 }}>
    <p className="eyebrow">Attendance review</p>
    <h1>欠席連絡の確認</h1>
    <p>AIの抽出結果は未確定です。生徒・日付・授業を確認してからNotionへ登録してください。</p>
    <section className="panel" style={{ padding: 16, marginTop: 20, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: 6, minWidth: 220 }}><span>確認者名</span><input style={inputStyle} value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="例：吉川" /></label>
      <button style={buttonStyle} disabled={busy} onClick={analyze}>{busy ? "解析中…" : "新しいLINEを解析"}</button>
      {message && <p style={{ flexBasis: "100%" }}>{message}</p>}
    </section>
    <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
      {candidates.length === 0 && <section className="panel" style={{ padding: 24 }}>未確認の欠席候補はありません。</section>}
      {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} students={students} confirmedBy={confirmedBy} onChanged={load} setMessage={setMessage} />)}
    </div>
  </main>;
}

function CandidateCard({ candidate, students, confirmedBy, onChanged, setMessage }: { candidate: Candidate; students: Student[]; confirmedBy: string; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const [studentNumber, setStudentNumber] = useState(candidate.student_number ?? "");
  const [date, setDate] = useState(candidate.event_date ?? "");
  const [eventType, setEventType] = useState(candidate.event_type);
  const [lessonId, setLessonId] = useState(candidate.lesson_id ?? "");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!date) return;
    fetch(`/api/attendance/lessons?date=${encodeURIComponent(date)}&student_number=${encodeURIComponent(studentNumber)}`).then((res) => res.json()).then((body) => setLessons(body.lessons ?? []));
  }, [date, studentNumber]);
  async function save() {
    const response = await fetch(`/api/attendance/candidates/${candidate.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_number: studentNumber, event_date: date, event_type: eventType, lesson_id: lessonId }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
  }
  async function confirmCandidate() {
    if (!confirmedBy.trim()) { setMessage("先に確認者名を入力してください。"); return; }
    setBusy(true);
    try { await save(); const response = await fetch(`/api/attendance/candidates/${candidate.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed_by: confirmedBy }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Notion登録に失敗しました"); setMessage("Notionへ登録しました。"); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function dismiss() { if (!window.confirm("この候補を対応不要にしますか？")) return; await fetch(`/api/attendance/candidates/${candidate.id}`, { method: "DELETE" }); await onChanged(); }
  return <section className="panel" style={{ padding: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{candidate.ai_summary ?? "欠席連絡候補"}</strong><span>AI信頼度 {Math.round((candidate.ai_confidence ?? 0) * 100)}%</span></div>
    <div style={{ margin: "14px 0", padding: 12, background: "#f7f7f4", borderRadius: 6, whiteSpace: "pre-wrap" }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
      <label>生徒<select style={inputStyle} value={studentNumber} onChange={(e) => { setStudentNumber(e.target.value); setLessonId(""); }}><option value="">要選択（AI候補: {candidate.suggested_student_name ?? "不明"}）</option>{students.map((student) => <option key={student.student_number} value={student.student_number}>{student.grade} {student.student_name}（{student.student_number}）</option>)}</select></label>
      <label>対象日<input style={inputStyle} type="date" value={date} onChange={(e) => { setDate(e.target.value); setLessonId(""); }} /></label>
      <label>種別<select style={inputStyle} value={eventType} onChange={(e) => setEventType(e.target.value)}><option value="absence">欠席</option><option value="late">遅刻</option><option value="reschedule_request">振替希望</option><option value="other">その他</option></select></label>
      <label>授業<select style={inputStyle} value={lessonId} onChange={(e) => setLessonId(e.target.value)}><option value="">授業未特定</option>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.start_time ?? "時刻なし"} {lesson.label} {lesson.campus ?? ""}</option>)}</select></label>
    </div>
    {candidate.notion_error && <p style={{ color: "#b42318", marginTop: 10 }}>前回のNotion登録エラー: {candidate.notion_error}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button style={buttonStyle} disabled={busy} onClick={confirmCandidate}>{busy ? "登録中…" : "確認してNotionへ登録"}</button><button style={{ ...buttonStyle, background: "#777" }} onClick={dismiss}>対応不要</button></div>
  </section>;
}
