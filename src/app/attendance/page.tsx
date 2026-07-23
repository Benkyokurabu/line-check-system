"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useMemo, useState } from "react";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null; grade?: string | null; subject?: string | null; class_name?: string | null; classroom?: string | null; enrolled?: boolean };
type StudentSuggestion = Student & { score: number; reason: string };
type SenderProfile = { display_name: string | null; alias_names: string[]; account_names: string[]; tag_names?: string[] };
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

const defaultReplyTemplates = [
  "ご連絡ありがとうございます。承知しました。本日の授業は欠席として登録いたします。",
  "ご連絡ありがとうございます。お大事になさってください。本日の授業は欠席として登録いたします。",
  "承知しました。振替が必要な場合はこちらで確認いたします。",
];

const reasonOptions = ["体調不良", "発熱", "学校行事", "通院", "家庭都合", "部活動", "交通事情", "振替希望", "欠席連絡"];

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

function lessonsByTime(lessons: Lesson[]) {
  return lessons.reduce<Array<{ time: string; lessons: Lesson[] }>>((groups, lesson) => {
    const time = lesson.start_time ?? "時刻なし";
    const current = groups.find((group) => group.time === time);
    if (current) current.lessons.push(lesson);
    else groups.push({ time, lessons: [lesson] });
    return groups;
  }, []);
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

export default function AttendancePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [replyTemplates, setReplyTemplates] = useState(defaultReplyTemplates);
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
      {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} students={students} confirmedBy={confirmedBy} replyTemplates={replyTemplates} onReplyTemplatesChanged={updateReplyTemplates} onChanged={load} setMessage={setMessage} />)}
    </div>
  </main>;
}

function CandidateCard({ candidate, students, confirmedBy, replyTemplates, onReplyTemplatesChanged, onChanged, setMessage }: { candidate: Candidate; students: Student[]; confirmedBy: string; replyTemplates: string[]; onReplyTemplatesChanged: (templates: string[]) => Promise<void>; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const lineManagedNames = useMemo(() => (candidate.sender_profile?.alias_names ?? [])
    .filter((value, index, values) => values.indexOf(value) === index), [candidate.sender_profile?.alias_names]);
  const lineManagedName = lineManagedNames.length > 0 ? lineManagedNames.join(" / ") : "未登録";
  const lineTagNames = candidate.sender_profile?.tag_names ?? [];
  const senderDisplayName = candidate.sender_profile?.display_name ?? candidate.line_messages?.display_name ?? "不明";
  const titleName = `${lineManagedName}（${senderDisplayName}）`;
  const receivedAtText = formatReceivedAt(candidate.line_messages?.received_at);
  const initialStudentNumber = candidate.student_number ?? candidate.student_suggestions?.[0]?.student_number ?? "";
  const initialCampus = campusFromLineManagedName(lineManagedNames[0]) || candidate.lessons?.campus || candidate.student_roster?.campus || "";
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber);
  const [date, setDate] = useState(candidate.event_date ?? "");
  const [eventType] = useState(candidate.event_type);
  const [lessonId, setLessonId] = useState(candidate.lesson_id ?? "");
  const [campus, setCampus] = useState(initialCampus);
  const [reason, setReason] = useState(candidate.ai_summary ?? "欠席連絡");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [replyText, setReplyText] = useState(replyTemplates[0] ?? defaultReplyTemplates[0]);
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
          return lesson.enrolled && ((subject && label.includes(subject)) || (className && label.includes(className)));
        }) ?? found.find((lesson) => lesson.enrolled) ?? found[0];
        setLessonId(recommended?.id ?? "");
        if (!campus && !campusFromLineManagedName(lineManagedNames[0])) setCampus(recommended?.campus ?? selectedStudent?.campus ?? "");
      });
  }, [date, studentNumber, candidate.suggested_subject, candidate.suggested_class_name, lessonId, campus, lineManagedNames, selectedStudent?.campus]);

  const currentLesson = lessons.find((lesson) => lesson.id === lessonId) ?? candidate.lessons;
  const selectedLesson = currentLesson && (!campus || currentLesson.campus === campus) ? currentLesson : null;
  const filteredLessons = campus ? lessons.filter((lesson) => lesson.campus === campus) : lessons;
  const lessonGroups = lessonsByTime(filteredLessons);

  function selectStudent(value: string) {
    setStudentNumber(value);
    setLessonId("");
  }

  function selectCampus(value: string) {
    setCampus(value);
    const selected = lessons.find((lesson) => lesson.id === lessonId) ?? candidate.lessons;
    if (value && selected?.campus !== value) setLessonId("");
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
    const response = await fetch(`/api/attendance/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_number: studentNumber, event_date: date, event_type: eventType, lesson_id: lessonId, ai_summary: reason.trim() || "欠席連絡" }),
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
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
      <strong style={{ fontSize: 18 }}>{titleName}</strong>
      <span style={{ color: "#666", fontSize: 13 }}>AI信頼度 {Math.round((candidate.ai_confidence ?? 0) * 100)}%</span>
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 24, marginTop: 8 }}>
      {lineTagNames.length > 0 ? lineTagNames.map((tag) => <span key={tag} style={tagStyle}>{tag}</span>) : <span style={{ color: "#777", fontSize: 13 }}>LINEタグ未登録</span>}
    </div>

    <div style={{ color: "#666", fontSize: 13, fontWeight: 700, marginTop: 12 }}>受信日時: {receivedAtText}</div>
    <div style={{ margin: "6px 0 14px", padding: 14, background: "#f7f7f4", border: "1px solid var(--line)", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>

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

    <label style={{ display: "grid", gap: 6, marginBottom: 12 }}><span>理由</span><div style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(reason) ? reason : ""} onChange={(event) => { if (event.target.value) setReason(event.target.value); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例：体調不良" /></div></label>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
      <label style={fieldStyle}>日付<input style={inputStyle} type="date" value={date} onChange={(event) => { setDate(event.target.value); setLessonId(""); }} /></label>
      <label style={fieldStyle}>授業<div style={readonlyStyle}>{selectedLesson ? selectedLesson.label : "要選択"}</div></label>
      <label style={fieldStyle}>校舎<select style={inputStyle} value={campus} onChange={(event) => selectCampus(event.target.value)}><option value="">要選択</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
      <label style={fieldStyle}>名前<select style={inputStyle} value={studentNumber} onChange={(event) => selectStudent(event.target.value)}><option value="">要選択</option>{studentOptions.map((student) => {
        const suggestion = suggestions.find((item) => item.student_number === student.student_number);
        const suffix = suggestion ? ` / ${suggestion.reason}` : "";
        return <option key={student.student_number} value={student.student_number}>{student.grade} {student.student_name}{suffix}</option>;
      })}</select></label>
      <label style={fieldStyle}>担任<div style={readonlyStyle}>{selectedStudent?.homeroom_teacher ?? "未設定"}</div></label>
    </div>

    <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
      {lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>{campus ? `${campus}の授業は見つかりませんでした。` : "この日の授業は見つかりませんでした。"}</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr)", gap: 8, alignItems: "center" }}>
        <div style={{ color: "#555", fontSize: 13, fontWeight: 700 }}>{group.time}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          {group.lessons.map((lesson) => {
            const selected = lesson.id === lessonId;
            const enrolled = Boolean(lesson.enrolled);
            return <button key={lesson.id} type="button" onClick={() => { setLessonId(lesson.id); setCampus(lesson.campus ?? campus); }} title={[lesson.campus, lesson.classroom && `${lesson.classroom}教室`, enrolled && "受講中"].filter(Boolean).join(" / ")} style={{ border: selected ? "2px solid var(--accent)" : enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: selected ? "#ecfdf3" : enrolled ? "#f2fbf5" : "white", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap", maxWidth: "100%" }}>
              <strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}
            </button>;
          })}
        </div>
      </div>)}
    </div>
    {cardMessage && <p role="status" style={{ color: cardMessage.includes("登録しました") || cardMessage.includes("コピー") || cardMessage.includes("送信しました") || cardMessage.includes("更新しました") ? "#087a3d" : "#b42318", marginTop: 10, fontWeight: 700 }}>{cardMessage}</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button style={buttonStyle} disabled={busy} onClick={confirmCandidate}>{busy ? "登録中..." : "確認してNotionへ登録"}</button><button style={secondaryButtonStyle} onClick={dismiss}>対応不要</button></div>
  </section>;
}