"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useMemo, useState } from "react";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null; grade?: string | null; subject?: string | null; class_name?: string | null; classroom?: string | null; enrolled?: boolean };
type StudentSuggestion = Student & { score: number; reason: string };
type SenderProfile = { display_name: string | null; alias_names: string[]; account_names: string[]; tag_names?: string[] };
type ReplyMessage = { id: string; text: string | null; received_at: string | null; sent_by: string | null };
type CandidateItem = {
  id: string; student_number: string | null; event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string | null;
  arrival_expected_time: string | null; note_internal: string | null; note_for_classroom: string | null;
  status: string; notion_error: string | null; lessons: Lesson | null;
};
type Candidate = {
  id: string; student_number: string | null; suggested_student_name: string | null;
  event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null;
  ai_summary: string | null; ai_confidence: number | null; ai_reason: string | null;
  status: string; notion_error: string | null;
  reply_status?: { sent: boolean; count: number; last_sent_at: string | null; last_sent_by: string | null };
  reply_messages?: ReplyMessage[];
  attendance_candidate_items?: CandidateItem[];
  sender_profile?: SenderProfile;
  student_suggestions?: StudentSuggestion[];
  student_selection_required?: boolean;
  student_selection_reason?: string | null;
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null; line_messages: { text: string | null; received_at: string | null; display_name: string | null; line_user_id?: string | null } | null;
};
type EditableItem = {
  client_id: string; id?: string; student_number: string; event_type: string; event_date: string; campus: string; lesson_id: string;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string;
  arrival_expected_time: string; note_internal: string; note_for_classroom: string; status?: string;
};
type ManualEvent = {
  id: string; contact_method: string; contact_received_at: string | null; received_by: string | null;
  student_number: string; lesson_id: string; event_date: string; event_type: string; reason: string | null;
  arrival_expected_time: string | null; note_internal: string | null; note_for_classroom: string | null;
  status: string; confirmed_by: string | null; confirmed_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
  notion_page_id: string | null; notion_status: string; notion_error: string | null;
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null;
};
type HistoryDays = "none" | 3 | 5 | 7 | 14;

const pageTitle = "遅刻・欠席確認";

const defaultReplyTemplates = [
  "ご連絡ありがとうございます。承知しました。本日の授業連絡として登録いたします。",
  "ご連絡ありがとうございます。承知しました。担当にも共有いたします。",
  "承知しました。必要があればこちらで確認いたします。",
];

const reasonOptions = ["体調不良", "発熱", "学校行事", "通院", "家庭都合", "部活動", "交通事情", "電車遅延", "欠席連絡", "遅刻連絡", "早退連絡", "その他"];
const eventTypeOptions = [
  { value: "absence", label: "欠席" },
  { value: "late", label: "遅刻" },
  { value: "early_leave", label: "早退" },
];
function eventTypeLabel(value: string) { return eventTypeOptions.find((option) => option.value === value)?.label ?? "その他"; }
function fallbackReason(value: string) { return value === "late" ? "遅刻連絡" : value === "early_leave" ? "早退連絡" : "欠席連絡"; }

const buttonStyle = { border: 0, borderRadius: 6, padding: "10px 14px", background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
const secondaryButtonStyle = { ...buttonStyle, background: "#555" } as const;
const dangerButtonStyle = { ...buttonStyle, background: "#b42318" } as const;
const ghostButtonStyle = { border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "white", color: "#222", fontWeight: 700, cursor: "pointer" } as const;
const inputStyle = { width: "100%", height: 40, boxSizing: "border-box", padding: "9px", border: "1px solid var(--line)", borderRadius: 6, background: "white" } as const;
const readonlyStyle = { ...inputStyle, minHeight: 40, background: "#f7f7f4", display: "flex", alignItems: "center" } as const;
const fieldStyle = { display: "grid", gap: 6, alignContent: "start" } as const;
const tagStyle = { display: "inline-flex", alignItems: "center", border: "1px solid #b7d7c2", background: "#f2fbf5", borderRadius: 6, padding: "3px 7px", color: "#087a3d", fontSize: 12, fontWeight: 700 } as const;

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

function formatReceivedAt(value: string | null | undefined) {
  if (!value) return "受信日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "受信日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatStatusTime(value: string | null | undefined) {
  if (!value) return "";
  const formatted = formatReceivedAt(value);
  return formatted === "受信日時不明" ? "" : formatted;
}

function statusBadgeStyle(kind: "done" | "pending" | "failed" | "partial") {
  if (kind === "done") return { border: "1px solid #b7d7c2", background: "#f2fbf5", color: "#087a3d" } as const;
  if (kind === "failed") return { border: "1px solid #fecaca", background: "#fef2f2", color: "#b42318" } as const;
  if (kind === "partial") return { border: "1px solid #fed7aa", background: "#fff7ed", color: "#c2410c" } as const;
  return { border: "1px solid var(--line)", background: "#f7f7f4", color: "#59635e" } as const;
}

function StatusBadge({ label, detail, kind }: { label: string; detail: string; kind: "done" | "pending" | "failed" | "partial" }) {
  return <span style={{ ...statusBadgeStyle(kind), display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "5px 9px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
    <span>{label}</span><span style={{ opacity: 0.82 }}>{detail}</span>
  </span>;
}

function normalizeLessonText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function lessonsByTime(lessons: Lesson[]) {
  return lessons.reduce<Array<{ time: string; lessons: Lesson[] }>>((groups, lesson) => {
    const time = lesson.start_time ?? "時刻なし";
    const current = groups.find((group) => group.time === time);
    if (current) current.lessons.push(lesson);
    else groups.push({ time, lessons: [lesson] });
    return groups;
  }, []);
}

function makeClientId() {
  return Math.random().toString(36).slice(2);
}

function initialItems(candidate: Candidate, initialCampus: string, fallbackStudentNumber: string) {
  const source = (candidate.attendance_candidate_items ?? []).length > 0 ? candidate.attendance_candidate_items! : [{
    id: "", student_number: candidate.student_number, event_type: candidate.event_type, event_date: candidate.event_date, lesson_id: candidate.lesson_id,
    suggested_subject: candidate.suggested_subject, suggested_class_name: candidate.suggested_class_name,
    ai_summary: candidate.ai_summary, arrival_expected_time: null, note_internal: null, note_for_classroom: null, status: candidate.status, notion_error: candidate.notion_error, lessons: candidate.lessons,
  }];
  return source.map((item) => ({
    client_id: item.id || makeClientId(),
    id: item.id || undefined,
    student_number: item.student_number ?? candidate.student_number ?? fallbackStudentNumber,
    event_type: item.event_type || candidate.event_type || "absence",
    event_date: item.event_date ?? "",
    campus: item.lessons?.campus ?? initialCampus,
    lesson_id: item.lesson_id ?? "",
    suggested_subject: item.suggested_subject,
    suggested_class_name: item.suggested_class_name,
    ai_summary: item.ai_summary ?? fallbackReason(item.event_type || candidate.event_type),
    arrival_expected_time: item.arrival_expected_time ?? "",
    note_internal: item.note_internal ?? "",
    note_for_classroom: item.note_for_classroom ?? "",
    status: item.status,
  }));
}

function candidateLesson(candidate: Candidate, item: EditableItem) {
  const itemLesson = candidate.attendance_candidate_items?.find((source) => source.id === item.id)?.lessons;
  if (itemLesson) return itemLesson;
  if (candidate.lesson_id === item.lesson_id) return candidate.lessons;
  return null;
}

export default function AttendancePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [replyTemplates, setReplyTemplates] = useState(defaultReplyTemplates);
  const [confirmedBy, setConfirmedBy] = useState("");
  const [historyDays, setHistoryDays] = useState<HistoryDays>("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEventsOpen, setManualEventsOpen] = useState(false);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(20);
  useEffect(() => {
    document.title = pageTitle;
  }, []);
  const load = useCallback(async () => {
    const query = historyDays === "none" ? "status=pending" : `status=review&days=${historyDays}`;
    const response = await fetch(`/api/attendance/candidates?${query}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "候補を取得できませんでした");
    setCandidates(body.candidates ?? []);
    setVisibleCandidateCount(20);
  }, [historyDays]);
  useEffect(() => {
    async function initialize() {
      try {
        const [, studentBody, templateBody] = await Promise.all([
          load(),
          fetch("/api/attendance/students").then((res) => res.json()),
          fetch("/api/attendance/reply-templates").then((res) => res.json()),
        ]);
        setStudents(studentBody.students ?? []);
        setReplyTemplates(templateBody.templates ?? defaultReplyTemplates);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void initialize();
  }, [load]);

  async function updateReplyTemplates(nextTemplates: string[]) {
    const response = await fetch("/api/attendance/reply-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates: nextTemplates }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "文案の保存に失敗しました");
    setReplyTemplates(body.templates ?? nextTemplates);
  }

  async function analyze() {
    setBusy(true); setMessage("確認中...");
    try {
      const response = await fetch("/api/attendance/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "解析に失敗しました");
      setMessage(`${body.processed}件を解析し、連絡候補${body.candidates}件を追加しました。対象外${body.ignored}件、失敗${body.failed}件です。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="shell" style={{ maxWidth: 1180 }}>
    <p className="eyebrow">Attendance review</p>
    <h1>遅刻・欠席連絡の確認</h1>
    <p>LINEの確認作業に近い流れで、返信文案とNotion登録内容を確認できます。</p>
    <section className="panel" style={{ padding: 16, marginTop: 20, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: 6, minWidth: 220 }}><span>確認者名</span><input style={inputStyle} value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="例：吉川" /></label>
      <button style={buttonStyle} disabled={busy} onClick={analyze}>{busy ? "確認中" : "新しくLINEを確認"}</button>
      <button type="button" style={secondaryButtonStyle} onClick={() => setManualOpen((value) => !value)}>{manualOpen ? "手入力を閉じる" : "電話・口頭連絡を手入力"}</button>
      <label style={{ display: "grid", gap: 6, minWidth: 150 }}><span>対応済み表示</span><select style={inputStyle} value={historyDays} onChange={(event) => setHistoryDays(event.target.value === "none" ? "none" : Number(event.target.value) as HistoryDays)}><option value="none">しない</option><option value={3}>直近3日</option><option value={5}>直近5日</option><option value={7}>直近7日</option><option value={14}>直近14日</option></select></label>
      {message && <p style={{ flexBasis: "100%" }}>{message}</p>}
    </section>
    {manualOpen && <ManualEntryForm students={students} confirmedBy={confirmedBy} onSaved={async () => { setMessage("手入力の欠席・遅刻を登録しました。"); setManualRefreshKey((value) => value + 1); setManualOpen(false); }} />}
    <div style={{ marginTop: 16 }}>
      <button type="button" style={secondaryButtonStyle} onClick={() => setManualEventsOpen((value) => !value)}>{manualEventsOpen ? "手入力済み連絡を閉じる" : "本日以降の手入力済み連絡を表示"}</button>
    </div>
    {manualEventsOpen && <ManualEventsPanel students={students} confirmedBy={confirmedBy} refreshKey={manualRefreshKey} onChanged={() => setManualRefreshKey((value) => value + 1)} />}
    <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
      {candidates.length === 0 && <section className="panel" style={{ padding: 24 }}>{historyDays === "none" ? "未確認の連絡候補はありません。" : "未確認・対応済みの連絡候補はありません。"}</section>}
      {candidates.slice(0, visibleCandidateCount).map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} students={students} confirmedBy={confirmedBy} replyTemplates={replyTemplates} onReplyTemplatesChanged={updateReplyTemplates} onChanged={load} setMessage={setMessage} />)}
      {visibleCandidateCount < candidates.length && <button type="button" style={secondaryButtonStyle} onClick={() => setVisibleCandidateCount((count) => count + 20)}>続きを表示（残り{candidates.length - visibleCandidateCount}件）</button>}
    </div>
  </main>;
}

function todayJst() {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date());
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function studentMatches(student: Student, query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  return normalizeSearchText(`${student.grade}${student.student_name}${student.student_number}${student.campus ?? ""}${student.homeroom_teacher ?? ""}`).includes(normalized);
}

function orderedStudentOptions(students: Student[], selectedNumber: string, query: string, candidates: Student[] = []) {
  const candidateNumbers = new Set(candidates.map((student) => student.student_number));
  const selected = students.find((student) => student.student_number === selectedNumber);
  const primary = [selected, ...candidates].filter((student): student is Student => Boolean(student));
  const seen = new Set<string>();
  const ordered = [
    ...primary,
    ...students.filter((student) => !candidateNumbers.has(student.student_number)),
  ].filter((student) => {
    if (seen.has(student.student_number)) return false;
    seen.add(student.student_number);
    return studentMatches(student, query);
  });
  return ordered.slice(0, query.trim() ? 80 : 160);
}

function StudentPicker({ label, students, value, onChange, query, onQueryChange, candidates = [], disabled = false }: {
  label: string;
  students: Student[];
  value: string;
  onChange: (value: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  candidates?: Student[];
  disabled?: boolean;
}) {
  const candidateNumbers = new Set(candidates.map((student) => student.student_number));
  const options = orderedStudentOptions(students, value, query, candidates);
  return <label style={fieldStyle}>{label}<div style={{ display: "grid", gap: 6 }}>
    <input style={inputStyle} value={query} disabled={disabled} onChange={(event) => onQueryChange(event.target.value)} placeholder="名前・学年・校舎で検索" />
    <select style={inputStyle} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">要選択</option>
      {options.map((student) => <option key={student.student_number} value={student.student_number}>{student.grade} {student.student_name}{candidateNumbers.has(student.student_number) ? " / 候補" : ""}</option>)}
    </select>
  </div></label>;
}
function ManualEntryForm({ students, confirmedBy, onSaved }: { students: Student[]; confirmedBy: string; onSaved: () => Promise<void> }) {
  const [contactMethod, setContactMethod] = useState("phone");
  const [receivedBy, setReceivedBy] = useState(confirmedBy);
  const [studentNumber, setStudentNumber] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [eventDate, setEventDate] = useState(todayJst());
  const [campus, setCampus] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [eventType, setEventType] = useState("absence");
  const [reason, setReason] = useState("体調不良");
  const [arrivalExpectedTime, setArrivalExpectedTime] = useState("");
  const [noteInternal, setNoteInternal] = useState("");
  const [noteForClassroom, setNoteForClassroom] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedStudent = students.find((student) => student.student_number === studentNumber) ?? null;

  useEffect(() => {
    if (!eventDate) return;
    const query = new URLSearchParams({ date: eventDate });
    if (studentNumber) query.set("student_number", studentNumber);
    fetch(`/api/attendance/lessons?${query.toString()}`)
      .then((response) => response.json())
      .then((body) => setLessons(body.lessons ?? []))
      .catch(() => setLessons([]));
  }, [eventDate, studentNumber]);
  const effectiveReceivedBy = receivedBy || confirmedBy;
  const effectiveCampus = campus || selectedStudent?.campus || "";
  const candidateStudents = effectiveCampus ? students.filter((student) => student.campus === effectiveCampus) : [];

  async function saveManualEvent() {
    if (!effectiveReceivedBy.trim()) { setMessage("受付者名を入力してください。"); return; }
    if (!studentNumber) { setMessage("生徒を選択してください。"); return; }
    if (!eventDate) { setMessage("対象日を入力してください。"); return; }
    if (!lessonId) { setMessage("授業を選択してください。"); return; }
    setSaving(true);
    setMessage("保存しています...");
    try {
      const response = await fetch("/api/attendance/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_method: contactMethod,
          contact_received_at: new Date().toISOString(),
          received_by: effectiveReceivedBy,
          student_number: studentNumber,
          lesson_id: lessonId,
          event_date: eventDate,
          event_type: eventType,
          reason,
          arrival_expected_time: arrivalExpectedTime,
          note_internal: noteInternal,
          note_for_classroom: noteForClassroom,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
      setMessage("保存しました。");
      setLessonId("");
      setArrivalExpectedTime("");
      setNoteInternal("");
      setNoteForClassroom("");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const filteredLessons = effectiveCampus ? lessons.filter((lesson) => lesson.campus === effectiveCampus) : lessons;
  const lessonGroups = lessonsByTime(filteredLessons);

  return <section className="panel" style={{ padding: 16, marginTop: 16, display: "grid", gap: 12 }}>
    <strong>電話・口頭連絡を手入力</strong>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
      <label style={fieldStyle}>連絡経路<select style={inputStyle} value={contactMethod} onChange={(event) => setContactMethod(event.target.value)}><option value="phone">電話</option><option value="oral">口頭</option><option value="other">その他</option></select></label>
      <label style={fieldStyle}>受付者名<input style={inputStyle} value={effectiveReceivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="例: 吉川" /></label>
      <StudentPicker label="生徒" students={students} value={studentNumber} query={studentQuery} onQueryChange={setStudentQuery} candidates={candidateStudents} onChange={(value) => { setStudentNumber(value); setLessonId(""); }} />
      <label style={fieldStyle}>対象日<input style={inputStyle} type="date" value={eventDate} onChange={(event) => { setEventDate(event.target.value); setLessonId(""); }} /></label>
      <label style={fieldStyle}>種別<select style={inputStyle} value={eventType} onChange={(event) => setEventType(event.target.value)}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label style={fieldStyle}>校舎<select style={inputStyle} value={effectiveCampus} onChange={(event) => { setCampus(event.target.value); setLessonId(""); }}><option value="">校舎すべて</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
      <label style={fieldStyle}>理由<div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(reason) ? reason : ""} onChange={(event) => { if (event.target.value) setReason(event.target.value); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={reason} onChange={(event) => setReason(event.target.value)} /></div></label>
      <label style={fieldStyle}>到着予定時刻<input style={inputStyle} value={arrivalExpectedTime} disabled={eventType !== "late"} onChange={(event) => setArrivalExpectedTime(event.target.value)} placeholder="例: 19:10" /></label>
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 700 }}>授業</span>
      {lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>対象日の授業が見つかりません。</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
        <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{group.lessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => { setLessonId(lesson.id); setCampus(lesson.campus ?? effectiveCampus); }} style={{ border: lesson.id === lessonId ? "2px solid var(--accent)" : lesson.enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: lesson.id === lessonId ? "#ecfdf3" : lesson.enrolled ? "#f2fbf5" : "white", cursor: "pointer", textAlign: "left" }}><strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{lesson.enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}</button>)}</div>
      </div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
      <label style={fieldStyle}>教室向けメモ<input style={inputStyle} value={noteForClassroom} onChange={(event) => setNoteForClassroom(event.target.value)} placeholder="教室PCに出してよい補足だけ" /></label>
      <label style={fieldStyle}>内部メモ<textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={noteInternal} onChange={(event) => setNoteInternal(event.target.value)} placeholder="教室PCには表示しないメモ" /></label>
    </div>
    {message && <p style={{ color: message.includes("保存しました") ? "#087a3d" : "#b42318", fontWeight: 700 }}>{message}</p>}
    <div><button type="button" style={buttonStyle} disabled={saving} onClick={saveManualEvent}>{saving ? "保存中..." : "確定データとして保存"}</button></div>
  </section>;
}
function contactMethodLabel(value: string) {
  if (value === "phone") return "電話";
  if (value === "oral") return "口頭";
  return "その他";
}

function eventStudent(event: ManualEvent) {
  return event.student_roster ? `${event.student_roster.grade} ${event.student_roster.student_name}` : event.student_number;
}

function ManualEventsPanel({ students, confirmedBy, refreshKey, onChanged }: { students: Student[]; confirmedBy: string; refreshKey: number; onChanged: () => void }) {
  const [events, setEvents] = useState<ManualEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [draft, setDraft] = useState({
    contact_method: "phone",
    received_by: confirmedBy,
    student_number: "",
    event_date: todayJst(),
    campus: "",
    lesson_id: "",
    event_type: "absence",
    reason: "体調不良",
    arrival_expected_time: "",
    note_internal: "",
    note_for_classroom: "",
  });

  const loadManualEvents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/attendance/events");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "手入力済み一覧を取得できませんでした");
      setEvents(body.events ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadManualEvents();
  }, [loadManualEvents, refreshKey]);

  useEffect(() => {
    if (!editingId || !draft.event_date) return;
    const query = new URLSearchParams({ date: draft.event_date });
    if (draft.student_number) query.set("student_number", draft.student_number);
    fetch(`/api/attendance/lessons?${query.toString()}`)
      .then((response) => response.json())
      .then((body) => setLessons(body.lessons ?? []))
      .catch(() => setLessons([]));
  }, [editingId, draft.event_date, draft.student_number]);

  function startEdit(event: ManualEvent) {
    setEditingId(event.id);
    setStudentQuery(event.student_roster?.student_name ?? "");
    setMessage("");
    setDraft({
      contact_method: event.contact_method,
      received_by: event.received_by ?? confirmedBy,
      student_number: event.student_number,
      event_date: event.event_date,
      campus: event.lessons?.campus ?? event.student_roster?.campus ?? "",
      lesson_id: event.lesson_id,
      event_type: event.event_type,
      reason: event.reason ?? fallbackReason(event.event_type),
      arrival_expected_time: event.arrival_expected_time ?? "",
      note_internal: event.note_internal ?? "",
      note_for_classroom: event.note_for_classroom ?? "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    setMessage("保存しています...");
    const response = await fetch(`/api/attendance/events/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "修正に失敗しました");
      return;
    }
    setMessage(body.notion_failed ? `修正しました。Notion反映に失敗しました: ${body.notion_error}` : "修正してNotionへ反映しました。");
    setEditingId(null);
    await loadManualEvents();
    onChanged();
  }

  async function cancelEvent(event: ManualEvent) {
    if (!window.confirm(`${eventStudent(event)} / ${event.lessons?.label ?? "授業未取得"} を取り消しますか？`)) return;
    setMessage("取り消しています...");
    const response = await fetch(`/api/attendance/events/${event.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelled_by: confirmedBy }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "取消しに失敗しました");
      return;
    }
    setMessage(body.notion_failed ? `取り消しました。Notion反映に失敗しました: ${body.notion_error}` : "取り消してNotionへ反映しました。");
    await loadManualEvents();
    onChanged();
  }

  const currentStudent = students.find((student) => student.student_number === draft.student_number) ?? null;
  const effectiveCampus = draft.campus || currentStudent?.campus || "";
  const candidateStudents = effectiveCampus ? students.filter((student) => student.campus === effectiveCampus) : [];
  const filteredLessons = effectiveCampus ? lessons.filter((lesson) => lesson.campus === effectiveCampus) : lessons;
  const lessonGroups = lessonsByTime(filteredLessons);

  return <section className="panel" style={{ padding: 16, marginTop: 16, display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <strong>手入力済み連絡</strong>
      <button type="button" style={ghostButtonStyle} onClick={() => void loadManualEvents()}>{loading ? "更新中..." : "更新"}</button>
    </div>
    {message && <p style={{ color: message.includes("失敗") ? "#b42318" : "#087a3d", fontWeight: 700 }}>{message}</p>}
    {events.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, color: "#777" }}>本日以降の手入力済み連絡はありません。</div> : <div style={{ display: "grid", gap: 8 }}>
      {events.map((event) => <div key={event.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, display: "grid", gap: 8, background: event.status === "cancelled" ? "#f7f7f4" : "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>{event.event_date} {event.lessons?.start_time ?? "時刻なし"} {event.lessons?.label ?? "授業未取得"}</strong>
            <span style={{ color: "#555", fontSize: 13, fontWeight: 700 }}>{eventStudent(event)} / {event.lessons?.campus ?? "校舎不明"}{event.lessons?.classroom ? ` ${event.lessons.classroom}教室` : ""} / {eventTypeLabel(event.event_type)} / {event.reason ?? fallbackReason(event.event_type)}</span>
            <span style={{ color: "#666", fontSize: 12 }}>{contactMethodLabel(event.contact_method)} / 受付: {event.received_by ?? "未入力"} / Notion: {event.notion_status}{event.notion_error ? ` / ${event.notion_error}` : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            {event.status === "cancelled" ? <span style={{ color: "#b42318", fontWeight: 800 }}>取消済み</span> : <>
              <button type="button" style={ghostButtonStyle} onClick={() => startEdit(event)}>修正</button>
              <button type="button" style={dangerButtonStyle} onClick={() => void cancelEvent(event)}>取消し</button>
            </>}
          </div>
        </div>
        {editingId === event.id && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            <label style={fieldStyle}>連絡経路<select style={inputStyle} value={draft.contact_method} onChange={(e) => setDraft((d) => ({ ...d, contact_method: e.target.value }))}><option value="phone">電話</option><option value="oral">口頭</option><option value="other">その他</option></select></label>
            <label style={fieldStyle}>受付者名<input style={inputStyle} value={draft.received_by} onChange={(e) => setDraft((d) => ({ ...d, received_by: e.target.value }))} /></label>
            <StudentPicker label="生徒" students={students} value={draft.student_number} query={studentQuery} onQueryChange={setStudentQuery} candidates={candidateStudents} onChange={(value) => setDraft((d) => ({ ...d, student_number: value, lesson_id: "" }))} />
            <label style={fieldStyle}>対象日<input style={inputStyle} type="date" value={draft.event_date} onChange={(e) => setDraft((d) => ({ ...d, event_date: e.target.value, lesson_id: "" }))} /></label>
            <label style={fieldStyle}>種別<select style={inputStyle} value={draft.event_type} onChange={(e) => setDraft((d) => ({ ...d, event_type: e.target.value }))}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label style={fieldStyle}>校舎<select style={inputStyle} value={effectiveCampus} onChange={(e) => setDraft((d) => ({ ...d, campus: e.target.value, lesson_id: "" }))}><option value="">校舎すべて</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
            <label style={fieldStyle}>理由<input style={inputStyle} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} /></label>
            <label style={fieldStyle}>到着予定時刻<input style={inputStyle} value={draft.arrival_expected_time} disabled={draft.event_type !== "late"} onChange={(e) => setDraft((d) => ({ ...d, arrival_expected_time: e.target.value }))} /></label>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>授業</span>
            {lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>対象日の授業が見つかりません。</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
              <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{group.lessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => setDraft((d) => ({ ...d, lesson_id: lesson.id, campus: lesson.campus ?? d.campus }))} style={{ border: lesson.id === draft.lesson_id ? "2px solid var(--accent)" : lesson.enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: lesson.id === draft.lesson_id ? "#ecfdf3" : lesson.enrolled ? "#f2fbf5" : "white", cursor: "pointer", textAlign: "left" }}><strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{lesson.enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}</button>)}</div>
            </div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
            <label style={fieldStyle}>教室向けメモ<input style={inputStyle} value={draft.note_for_classroom} onChange={(e) => setDraft((d) => ({ ...d, note_for_classroom: e.target.value }))} /></label>
            <label style={fieldStyle}>内部メモ<textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={draft.note_internal} onChange={(e) => setDraft((d) => ({ ...d, note_internal: e.target.value }))} /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}><button type="button" style={buttonStyle} onClick={() => void saveEdit()}>保存してNotion反映</button><button type="button" style={ghostButtonStyle} onClick={() => setEditingId(null)}>閉じる</button></div>
        </div>}
      </div>)}
    </div>}
  </section>;
}
function CandidateCard({ candidate, students, confirmedBy, replyTemplates, onReplyTemplatesChanged, onChanged, setMessage }: { candidate: Candidate; students: Student[]; confirmedBy: string; replyTemplates: string[]; onReplyTemplatesChanged: (templates: string[]) => Promise<void>; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const lineManagedNames = useMemo(() => (candidate.sender_profile?.alias_names ?? [])
    .filter((value, index, values) => values.indexOf(value) === index), [candidate.sender_profile?.alias_names]);
  const lineManagedName = lineManagedNames.length > 0 ? lineManagedNames.join(" / ") : "未登録";
  const lineTagNames = candidate.sender_profile?.tag_names ?? [];
  const senderDisplayName = candidate.sender_profile?.display_name ?? candidate.line_messages?.display_name ?? "不明";
  const titleName = `${lineManagedName}（${senderDisplayName}）`;
  const senderLineUserId = candidate.line_messages?.line_user_id ?? null;
  const receivedAtText = formatReceivedAt(candidate.line_messages?.received_at);
  const initialStudentNumber = candidate.student_number ?? (candidate.student_selection_required ? "" : candidate.student_suggestions?.[0]?.student_number ?? "");
  const initialCampus = campusFromLineManagedName(lineManagedNames[0]) || candidate.lessons?.campus || candidate.student_roster?.campus || "";
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber);
  const [studentQuery, setStudentQuery] = useState("");
  const [items, setItems] = useState<EditableItem[]>(() => initialItems(candidate, initialCampus, initialStudentNumber));
  const [itemStudentQueries, setItemStudentQueries] = useState<Record<string, string>>({});
  const registered = candidate.status === "confirmed";
  const itemStatuses = candidate.attendance_candidate_items ?? [];
  const confirmedItems = itemStatuses.filter((item) => item.status === "confirmed").length;
  const failedItems = itemStatuses.filter((item) => item.status === "notion_failed").length;
  const notionKind = candidate.notion_error || failedItems > 0 ? "failed" : registered ? "done" : confirmedItems > 0 ? "partial" : "pending";
  const notionDetail = notionKind === "failed" ? "エラー" : registered ? "登録済み" : confirmedItems > 0 ? `${confirmedItems}/${Math.max(itemStatuses.length, items.length)}行` : "未登録";
  const replyStatus = candidate.reply_status;
  const replyKind = replyStatus?.sent ? "done" : "pending";
  const replyDetail = replyStatus?.sent ? ["送信済み", replyStatus.last_sent_by, formatStatusTime(replyStatus.last_sent_at)].filter(Boolean).join(" / ") : "未送信";
  const [lessonLists, setLessonLists] = useState<Record<string, Lesson[]>>({});
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [replyText, setReplyText] = useState(replyTemplates[0] ?? defaultReplyTemplates[0]);
  const [linkingSender, setLinkingSender] = useState(false);
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
  const datesKey = useMemo(() => [...new Set(items.map((item) => item.event_date).filter(Boolean))].sort().join("|"), [items]);

  useEffect(() => {
    const dates = datesKey ? datesKey.split("|") : [];
    for (const date of dates) {
      fetch(`/api/attendance/lessons?date=${encodeURIComponent(date)}&student_number=${encodeURIComponent(studentNumber)}`)
        .then((res) => res.json())
        .then((body) => {
          const found = (body.lessons ?? []) as Lesson[];
          setLessonLists((current) => ({ ...current, [date]: found }));
          setItems((currentItems) => currentItems.map((item) => {
            if (item.event_date !== date || item.lesson_id) return item;
            const subject = normalizeLessonText(item.suggested_subject);
            const className = normalizeLessonText(item.suggested_class_name);
            const recommended = found.find((lesson) => {
              const label = normalizeLessonText(lesson.label);
              return lesson.enrolled && ((subject && label.includes(subject)) || (className && label.includes(className)));
            }) ?? found.find((lesson) => lesson.enrolled) ?? null;
            if (!recommended) return item;
            return { ...item, lesson_id: recommended.id, campus: item.campus || recommended.campus || selectedStudent?.campus || "" };
          }));
        });
    }
  }, [datesKey, studentNumber, selectedStudent?.campus]);

  function updateItem(clientId: string, patch: Partial<EditableItem>) {
    setItems((current) => current.map((item) => item.client_id === clientId ? { ...item, ...patch } : item));
  }

  function selectStudent(value: string) {
    setStudentNumber(value);
    setItems((current) => current.map((item) => ({ ...item, student_number: value, lesson_id: "" })));
  }

  async function linkSenderToSelectedStudent() {
    if (!senderLineUserId) { setCardMessage("このLINE連絡先のIDを取得できません。"); return; }
    if (!studentNumber) { setCardMessage("先に名前を選択してください。"); return; }
    const student = studentOptions.find((item) => item.student_number === studentNumber);
    if (!student) { setCardMessage("選択中の生徒を確認できません。"); return; }
    const aliasName = lineManagedName !== "未登録" ? lineManagedName : senderDisplayName;
    if (!window.confirm(`${student.grade} ${student.student_name} に ${titleName} を保護者LINEとして登録します。よろしいですか？`)) return;
    setLinkingSender(true);
    setCardMessage("LINE連絡先を登録しています...");
    try {
      const response = await fetch(`/api/students/${encodeURIComponent(studentNumber)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: senderLineUserId,
          relation: "guardian",
          alias_name: aliasName,
          friend_display_name: senderDisplayName === "不明" ? null : senderDisplayName,
          is_primary: false,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "LINE連絡先の登録に失敗しました");
      setCardMessage("選択中の生徒へ保護者LINEとして登録しました。");
      setMessage("LINE連絡先を登録しました。");
      await onChanged();
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLinkingSender(false);
    }
  }
  function addItem() {
    const previous = items[items.length - 1];
    setItems((current) => [...current, {
      client_id: makeClientId(),
      student_number: previous?.student_number ?? studentNumber,
      event_type: previous?.event_type ?? candidate.event_type ?? "absence",
      event_date: previous?.event_date ?? candidate.event_date ?? "",
      campus: previous?.campus ?? initialCampus,
      lesson_id: "",
      suggested_subject: null,
      suggested_class_name: null,
      ai_summary: previous?.ai_summary ?? fallbackReason(candidate.event_type),
      arrival_expected_time: previous?.arrival_expected_time ?? "",
      note_internal: "",
      note_for_classroom: "",
    }]);
  }

  function removeItem(clientId: string) {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.client_id !== clientId));
    setItemStudentQueries((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }

  function selectTemplate(index: number) {
    setSelectedTemplateIndex(index);
    setReplyText(replyTemplates[index] ?? "");
  }

  async function saveCurrentTemplate() {
    if (!replyText.trim()) { setCardMessage("保存する文案を入力してください。"); return; }
    setSavingTemplate(true);
    setCardMessage("");
    try {
      const nextTemplates = [...replyTemplates];
      nextTemplates[selectedTemplateIndex] = replyText.trim();
      await onReplyTemplatesChanged(nextTemplates);
      setCardMessage(`文案${selectedTemplateIndex + 1}を更新しました。`);
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSavingTemplate(false); }
  }

  async function save() {
    const firstItem = items[0];
    const response = await fetch(`/api/attendance/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_number: firstItem?.student_number || studentNumber,
        event_date: firstItem?.event_date || null,
        event_type: firstItem?.event_type || candidate.event_type,
        lesson_id: firstItem?.lesson_id || null,
        ai_summary: firstItem?.ai_summary?.trim() || fallbackReason(firstItem?.event_type || candidate.event_type),
        items: items.map((item) => ({
          student_number: item.student_number,
          event_type: item.event_type,
          event_date: item.event_date || null,
          lesson_id: item.lesson_id || null,
          suggested_subject: item.suggested_subject,
          suggested_class_name: item.suggested_class_name,
          ai_summary: item.ai_summary.trim() || fallbackReason(item.event_type),
          arrival_expected_time: item.arrival_expected_time.trim() || null,
          note_internal: item.note_internal.trim() || null,
          note_for_classroom: item.note_for_classroom.trim() || null,
        })),
      }),
    });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
  }

  async function confirmCandidate() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    const invalidStudent = items.find((item) => !item.student_number);
    if (invalidStudent) { setCardMessage("すべての登録行で名前を選択してください。"); return; }
    const invalid = items.find((item) => !item.event_date || !item.campus || !item.lesson_id || !item.ai_summary.trim());
    if (invalid) { setCardMessage("すべての登録行で、日付・校舎・授業・理由を入力してください。"); return; }
    setBusy(true);
    setCardMessage("Notionへ登録しています...");
    try {
      await save();
      const response = await fetch(`/api/attendance/candidates/${candidate.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_by: confirmedBy }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Notion登録に失敗しました");
      setCardMessage(`${body.notion_page_ids?.length ?? 1}行をNotionへ登録しました。`);
      setMessage("Notionへ登録しました。");
      await onChanged();
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function sendReply() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!replyText.trim()) { setCardMessage("返信文を入力してください。"); return; }
    if (!window.confirm(`${titleName} にLINE返信を送信します。よろしいですか？`)) return;
    setSending(true);
    setCardMessage("LINEへ送信しています...");
    try {
      const response = await fetch(`/api/attendance/candidates/${candidate.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText, sent_by: confirmedBy }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.line_delivered ? "LINE送信済みですが履歴保存に失敗しました。再送しないでください。" : body.error ?? "LINE送信に失敗しました");
      }
      setCardMessage("LINEへ送信しました。");
      setMessage("LINEへ送信しました。");
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSending(false); }
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
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <strong style={{ fontSize: 18 }}>{titleName}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge label="LINE返信" detail={replyDetail} kind={replyKind} />
          <StatusBadge label="Notion" detail={notionDetail} kind={notionKind} />
        </div>
      </div>
      <span style={{ color: registered ? "#087a3d" : "#666", fontSize: 13, fontWeight: 700 }}>{registered ? "登録済み / " : ""}{items.length}行 / AI信頼度 {Math.round((candidate.ai_confidence ?? 0) * 100)}%</span>
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 24, marginTop: 8 }}>
      {lineTagNames.length > 0 ? lineTagNames.map((tag) => <span key={tag} style={tagStyle}>{tag}</span>) : <span style={{ color: "#777", fontSize: 13 }}>LINEタグ未登録</span>}
    </div>

    <div style={{ color: "#666", fontSize: 13, fontWeight: 700, marginTop: 12 }}>受信日時: {receivedAtText}</div>
    <div style={{ margin: "6px 0 14px", padding: 14, background: "#f7f7f4", border: "1px solid var(--line)", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>
    <ReplyHistory replies={candidate.reply_messages ?? []} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) minmax(180px,260px)", gap: 12, alignItems: "start", marginBottom: 16 }}>
      <label style={{ display: "grid", gap: 6 }}><span>返信文</span><textarea style={{ ...inputStyle, minHeight: 96, resize: "vertical", lineHeight: 1.6 }} value={replyText} onChange={(event) => setReplyText(event.target.value)} /></label>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#555" }}>文案</span>
        {replyTemplates.map((template, index) => <button key={`${index}:${template}`} type="button" style={selectedTemplateIndex === index ? buttonStyle : ghostButtonStyle} onClick={() => selectTemplate(index)}>文案{index + 1}</button>)}
        <button type="button" style={ghostButtonStyle} disabled={savingTemplate} onClick={saveCurrentTemplate}>{savingTemplate ? "保存中..." : `文案${selectedTemplateIndex + 1}を更新`}</button>
        <button type="button" style={secondaryButtonStyle} onClick={copyReply}>コピー</button>
        <button type="button" style={dangerButtonStyle} disabled={sending} onClick={sendReply}>{sending ? "送信中..." : "LINEへ送信"}</button>
      </div>
    </div>

    {candidate.student_selection_required && <div style={{ border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412", borderRadius: 6, padding: 10, marginBottom: 12, fontWeight: 700 }}>{candidate.student_selection_reason ?? "兄弟姉妹の可能性があるため、名前を選択してください。"}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,280px) minmax(0,1fr) auto", gap: 12, marginBottom: 12, alignItems: "end" }}>
      <StudentPicker label="名前" students={studentOptions} value={studentNumber} query={studentQuery} onQueryChange={setStudentQuery} onChange={selectStudent} candidates={suggestions} disabled={registered} />
      <label style={fieldStyle}>担任<div style={readonlyStyle}>{selectedStudent?.homeroom_teacher ?? "未設定"}</div></label>
      {!registered && <button type="button" style={ghostButtonStyle} disabled={linkingSender || !senderLineUserId || !studentNumber} onClick={linkSenderToSelectedStudent}>{linkingSender ? "登録中..." : "このLINEを保護者として登録"}</button>}
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>Notion登録行</strong>
        {!registered && <button type="button" style={ghostButtonStyle} onClick={addItem}>行を追加</button>}
      </div>
      {items.map((item, index) => {
        const lessons = item.event_date ? lessonLists[item.event_date] ?? [] : [];
        const currentLesson = lessons.find((lesson) => lesson.id === item.lesson_id) ?? candidateLesson(candidate, item);
        const filteredLessons = item.campus ? lessons.filter((lesson) => lesson.campus === item.campus) : lessons;
        const lessonGroups = lessonsByTime(filteredLessons);
        return <div key={item.client_id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, display: "grid", gap: 10, background: item.status === "confirmed" ? "#f2fbf5" : "white" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.2fr) 110px 120px 130px minmax(220px,1fr) 42px", gap: 8, alignItems: "end" }}>
            <StudentPicker
              label="名前"
              students={studentOptions}
              value={item.student_number}
              query={itemStudentQueries[item.client_id] ?? ""}
              onQueryChange={(value) => setItemStudentQueries((current) => ({ ...current, [item.client_id]: value }))}
              onChange={(value) => updateItem(item.client_id, { student_number: value, lesson_id: "" })}
              candidates={suggestions}
              disabled={registered}
            />
            <label style={fieldStyle}>日付<input style={inputStyle} type="date" value={item.event_date} disabled={registered} onChange={(event) => updateItem(item.client_id, { event_date: event.target.value, lesson_id: "" })} /></label>
            <label style={fieldStyle}>種別<select style={inputStyle} value={item.event_type} disabled={registered} onChange={(event) => updateItem(item.client_id, { event_type: event.target.value, ai_summary: !item.ai_summary.trim() || item.ai_summary === fallbackReason(item.event_type) ? fallbackReason(event.target.value) : item.ai_summary })}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label style={fieldStyle}>校舎<select style={inputStyle} value={item.campus} disabled={registered} onChange={(event) => updateItem(item.client_id, { campus: event.target.value, lesson_id: currentLesson?.campus === event.target.value ? item.lesson_id : "" })}><option value="">要選択</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
            <label style={fieldStyle}>理由<div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(item.ai_summary) ? item.ai_summary : ""} disabled={registered} onChange={(event) => { if (event.target.value) updateItem(item.client_id, { ai_summary: event.target.value }); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={item.ai_summary} disabled={registered} onChange={(event) => updateItem(item.client_id, { ai_summary: event.target.value })} placeholder="例：体調不良" /></div></label>
            <button type="button" style={{ ...ghostButtonStyle, height: 40, padding: 0 }} disabled={registered || items.length <= 1} onClick={() => removeItem(item.client_id)}>削除</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 8 }}>
            <label style={fieldStyle}>到着予定時刻<input style={inputStyle} value={item.arrival_expected_time} disabled={registered || item.event_type !== "late"} onChange={(event) => updateItem(item.client_id, { arrival_expected_time: event.target.value })} placeholder="例: 19:10" /></label>
            <label style={fieldStyle}>教室向けメモ<input style={inputStyle} value={item.note_for_classroom} disabled={registered} onChange={(event) => updateItem(item.client_id, { note_for_classroom: event.target.value })} placeholder="教室PCに出してよい補足だけ" /></label>
          </div>
          <label style={fieldStyle}>内部メモ<textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={item.note_internal} disabled={registered} onChange={(event) => updateItem(item.client_id, { note_internal: event.target.value })} placeholder="教室PCには表示しないメモ" /></label>
          <div style={{ color: "#666", fontSize: 13 }}>{index + 1}行目: {item.event_date || "日付未選択"} / {eventTypeLabel(item.event_type)} / {currentLesson?.label ?? "授業未選択"}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {!item.event_date ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>日付を指定すると、その日の授業がここに表示されます。</div> : lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>{item.campus ? `${item.campus}の授業は見つかりませんでした。` : "この日の授業は見つかりませんでした。"}</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
              <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                {group.lessons.map((lesson) => {
                  const selected = lesson.id === item.lesson_id;
                  const enrolled = Boolean(lesson.enrolled);
                  return <button key={lesson.id} type="button" disabled={registered} onClick={() => updateItem(item.client_id, { lesson_id: lesson.id, campus: lesson.campus ?? item.campus })} title={[lesson.campus, lesson.classroom && `${lesson.classroom}教室`, enrolled && "受講中"].filter(Boolean).join(" / ")} style={{ border: selected ? "2px solid var(--accent)" : enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: selected ? "#ecfdf3" : enrolled ? "#f2fbf5" : "white", cursor: registered ? "default" : "pointer", textAlign: "left", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    <strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}
                  </button>;
                })}
              </div>
            </div>)}
          </div>
        </div>;
      })}
    </div>

    {cardMessage && <p role="status" style={{ color: cardMessage.includes("登録しました") || cardMessage.includes("コピー") || cardMessage.includes("送信しました") || cardMessage.includes("更新しました") ? "#087a3d" : "#b42318", marginTop: 10, fontWeight: 700 }}>{cardMessage}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button style={buttonStyle} disabled={busy || registered} onClick={confirmCandidate}>{registered ? "Notion登録済み" : busy ? "登録中..." : "確認してNotionへ登録"}</button>{!registered && <button style={secondaryButtonStyle} onClick={dismiss}>対応不要</button>}</div>
  </section>;
}
function ReplyHistory({ replies }: { replies: ReplyMessage[] }) {
  if (replies.length === 0) return null;
  return <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
    <strong>送信済み返信</strong>
    {replies.map((reply) => <div key={reply.id} style={{ border: "1px solid #b7d7c2", background: "#f2fbf5", borderRadius: 6, padding: 12 }}>
      <div style={{ color: "#087a3d", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>{[reply.sent_by, formatStatusTime(reply.received_at)].filter(Boolean).join(" / ") || "送信履歴"}</div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{reply.text ?? "（本文なし）"}</div>
    </div>)}
  </div>;
}
