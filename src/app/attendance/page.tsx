"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useMemo, useState } from "react";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null };
type StudentSuggestion = Student & { score: number; reason: string };
type SenderProfile = { display_name: string | null; alias_names: string[]; account_names: string[] };
type Candidate = {
  id: string; student_number: string | null; suggested_student_name: string | null;
  event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null;
  ai_summary: string | null; ai_confidence: number | null; ai_reason: string | null;
  status: string; notion_error: string | null;
  sender_profile?: SenderProfile;
  student_suggestions?: StudentSuggestion[];
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null; line_messages: { text: string | null; received_at: string | null; display_name: string | null } | null;
};

const buttonStyle = { border: 0, borderRadius: 6, padding: "10px 14px", background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
const secondaryButtonStyle = { ...buttonStyle, background: "#555" } as const;
const ghostButtonStyle = { border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "white", color: "#222", fontWeight: 700, cursor: "pointer" } as const;
const inputStyle = { width: "100%", padding: "9px", border: "1px solid var(--line)", borderRadius: 6, background: "white" } as const;
const readonlyStyle = { ...inputStyle, minHeight: 38, background: "#f7f7f4", display: "flex", alignItems: "center" } as const;
const replyTemplates = [
  "ご連絡ありがとうございます。承知しました。本日の授業は欠席として登録いたします。",
  "ご連絡ありがとうございます。お大事になさってください。本日の授業は欠席として登録いたします。",
  "承知しました。振替が必要な場合はこちらで確認いたします。",
];

function campusFromLineManagedName(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC");
  const prefix = normalized.match(/^([本南])\s/);
  if (prefix?.[1] === "本") return "本校";
  if (prefix?.[1] === "南") return "南教室";
  return "";
}

function uniqueByNumber(students: Student[]) {
  const seen = new Set<string>();
  return students.filter((student) => {
    if (seen.has(student.student_number)) return false;
    seen.add(student.student_number);
    return true;
  });
}

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
        const [, studentBody] = await Promise.all([load(), fetch("/api/attendance/students").then((res) => res.json())]);
        setStudents(studentBody.students ?? []);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void initialize();
  }, [load]);

  async function analyze() {
    setBusy(true); setMessage("LINEを解析しています...");
    try {
      const response = await fetch("/api/attendance/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "解析に失敗しました");
      setMessage(`${body.processed}件を解析し、欠席候補${body.candidates}件を追加しました。対象外${body.ignored}件、失敗${body.failed}件です。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="shell" style={{ maxWidth: 1180 }}>
    <p className="eyebrow">Attendance review</p>
    <h1>欠席連絡の確認</h1>
    <p>LINEの確認作業に近い流れで、返信文案とNotion登録内容を確認できます。</p>
    <section className="panel" style={{ padding: 16, marginTop: 20, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: 6, minWidth: 220 }}><span>確認者名</span><input style={inputStyle} value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="例：吉川" /></label>
      <button style={buttonStyle} disabled={busy} onClick={analyze}>{busy ? "解析中..." : "新しいLINEを解析"}</button>
      {message && <p style={{ flexBasis: "100%" }}>{message}</p>}
    </section>
    <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
      {candidates.length === 0 && <section className="panel" style={{ padding: 24 }}>未確認の欠席候補はありません。</section>}
      {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} students={students} confirmedBy={confirmedBy} onChanged={load} setMessage={setMessage} />)}
    </div>
  </main>;
}

function CandidateCard({ candidate, students, confirmedBy, onChanged, setMessage }: { candidate: Candidate; students: Student[]; confirmedBy: string; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const lineManagedNames = useMemo(() => (candidate.sender_profile?.alias_names ?? [])
    .filter((value, index, values) => values.indexOf(value) === index), [candidate.sender_profile?.alias_names]);
  const lineManagedName = lineManagedNames.length > 0 ? lineManagedNames.join(" / ") : "未登録";
  const senderDisplayName = candidate.sender_profile?.display_name ?? candidate.line_messages?.display_name ?? "不明";
  const titleName = `${lineManagedName}（${senderDisplayName}）`;
  const initialStudentNumber = candidate.student_number ?? candidate.student_suggestions?.[0]?.student_number ?? "";
  const initialCampus = campusFromLineManagedName(lineManagedNames[0]) || candidate.lessons?.campus || candidate.student_roster?.campus || "";
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber);
  const [date, setDate] = useState(candidate.event_date ?? "");
  const [eventType] = useState(candidate.event_type);
  const [lessonId, setLessonId] = useState(candidate.lesson_id ?? "");
  const [campus, setCampus] = useState(initialCampus);
  const [reason] = useState(candidate.ai_summary ?? "欠席連絡");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const [replyText, setReplyText] = useState(replyTemplates[0]);
  const suggestions = useMemo(() => candidate.student_suggestions ?? [], [candidate.student_suggestions]);
  const suggestionNumbers = useMemo(() => new Set(suggestions.map((student) => student.student_number)), [suggestions]);
  const studentOptions = useMemo(() => uniqueByNumber([
    ...suggestions,
    ...students.filter((student) => !suggestionNumbers.has(student.student_number)),
  ]), [students, suggestions, suggestionNumbers]);
  const selectedStudent = studentOptions.find((student) => student.student_number === studentNumber) ?? (
    candidate.student_number && candidate.student_roster ? {
      student_number: candidate.student_number,
      student_name: candidate.student_roster.student_name,
      grade: candidate.student_roster.grade,
      campus: candidate.student_roster.campus,
      homeroom_teacher: candidate.student_roster.homeroom_teacher,
    } : null
  );

  useEffect(() => {
    if (!date) return;
    fetch(`/api/attendance/lessons?date=${encodeURIComponent(date)}&student_number=${encodeURIComponent(studentNumber)}`)
      .then((res) => res.json())
      .then((body) => {
        const found = (body.lessons ?? []) as Lesson[];
        setLessons(found);
        if (found.some((lesson) => lesson.id === lessonId)) return;
        const normalize = (value: string | null | undefined) => (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
        const subject = normalize(candidate.suggested_subject);
        const className = normalize(candidate.suggested_class_name);
        const recommended = found.find((lesson) => {
          const label = normalize(lesson.label);
          return (subject && label.includes(subject)) || (className && label.includes(className));
        }) ?? found[0];
        setLessonId(recommended?.id ?? "");
        if (!campusFromLineManagedName(lineManagedNames[0])) setCampus(recommended?.campus ?? selectedStudent?.campus ?? "");
      });
  }, [date, studentNumber, candidate.suggested_subject, candidate.suggested_class_name, lessonId, lineManagedNames, selectedStudent?.campus]);

  const selectedLesson = lessons.find((lesson) => lesson.id === lessonId) ?? candidate.lessons;

  function selectStudent(value: string) {
    setStudentNumber(value);
    setLessonId("");
  }

  async function save() {
    const response = await fetch(`/api/attendance/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_number: studentNumber, event_date: date, event_type: eventType, lesson_id: lessonId, ai_summary: reason }),
    });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
  }

  async function confirmCandidate() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!studentNumber) { setCardMessage("名前を選択してください。"); return; }
    if (!date) { setCardMessage("日付を入力してください。"); return; }
    if (!campus) { setCardMessage("授業校舎を選択してください。"); return; }
    if (!lessonId) { setCardMessage("授業を選択してください。"); return; }
    setBusy(true);
    setCardMessage("Notionへ登録しています...");
    try {
      await save();
      const response = await fetch(`/api/attendance/candidates/${candidate.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_by: confirmedBy, campus }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Notion登録に失敗しました");
      setCardMessage("Notionへ登録しました。");
      setMessage("Notionへ登録しました。");
      await onChanged();
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function dismiss() {
    if (!window.confirm("この候補を対応不要にしますか？")) return;
    await fetch(`/api/attendance/candidates/${candidate.id}`, { method: "DELETE" });
    await onChanged();
  }

  async function copyReply() {
    await navigator.clipboard.writeText(replyText);
    setCardMessage("返信文案をコピーしました。");
  }

  return <section className="panel" style={{ padding: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
      <strong style={{ fontSize: 18 }}>{titleName}</strong>
      <span style={{ color: "#666", fontSize: 13 }}>AI信頼度 {Math.round((candidate.ai_confidence ?? 0) * 100)}%</span>
    </div>

    <div style={{ margin: "14px 0", padding: 14, background: "#f7f7f4", border: "1px solid var(--line)", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) minmax(180px,260px)", gap: 12, alignItems: "start", marginBottom: 16 }}>
      <label style={{ display: "grid", gap: 6 }}><span>返信文案</span><textarea style={{ ...inputStyle, minHeight: 96, resize: "vertical", lineHeight: 1.6 }} value={replyText} onChange={(event) => setReplyText(event.target.value)} /></label>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#555" }}>文案</span>
        {replyTemplates.map((template, index) => <button key={template} type="button" style={ghostButtonStyle} onClick={() => setReplyText(template)}>文案{index + 1}</button>)}
        <button type="button" style={secondaryButtonStyle} onClick={copyReply}>コピー</button>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
      <label>日付<input style={inputStyle} type="date" value={date} onChange={(event) => { setDate(event.target.value); setLessonId(""); }} /></label>
      <label>授業校舎<select style={inputStyle} value={campus} onChange={(event) => setCampus(event.target.value)}><option value="">要選択</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
      <label>授業<select style={inputStyle} value={lessonId} onChange={(event) => setLessonId(event.target.value)}><option value="">要選択</option>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.start_time ?? "時刻なし"} {lesson.label} {lesson.campus ?? ""}</option>)}</select></label>
      <label>名前<select style={inputStyle} value={studentNumber} onChange={(event) => selectStudent(event.target.value)}><option value="">要選択</option>{studentOptions.map((student) => {
        const suggestion = suggestions.find((item) => item.student_number === student.student_number);
        const suffix = suggestion ? ` / ${suggestion.reason}` : "";
        return <option key={student.student_number} value={student.student_number}>{student.grade} {student.student_name}{suffix}</option>;
      })}</select></label>
      <label>担任<div style={readonlyStyle}>{selectedStudent?.homeroom_teacher ?? "未設定"}</div></label>
    </div>

    {selectedLesson && <p style={{ marginTop: 8, color: "#666", fontSize: 13 }}>選択中の授業: {selectedLesson.start_time ?? "時刻なし"} {selectedLesson.label} {selectedLesson.campus ?? ""}</p>}
    {cardMessage && <p role="status" style={{ color: cardMessage.includes("登録しました") || cardMessage.includes("コピー") ? "#087a3d" : "#b42318", marginTop: 10, fontWeight: 700 }}>{cardMessage}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button style={buttonStyle} disabled={busy} onClick={confirmCandidate}>{busy ? "登録中..." : "確認してNotionへ登録"}</button><button style={secondaryButtonStyle} onClick={dismiss}>対応不要</button></div>
  </section>;
}