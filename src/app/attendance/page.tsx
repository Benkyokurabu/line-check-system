"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useMemo, useState } from "react";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null; grade?: string | null; subject?: string | null; class_name?: string | null; classroom?: string | null; enrolled?: boolean };
type StudentSuggestion = Student & { score: number; reason: string };
type SenderProfile = { display_name: string | null; alias_names: string[]; account_names: string[]; tag_names?: string[] };
type ReplyMessage = { id: string; text: string | null; received_at: string | null; sent_by: string | null };
type CandidateItem = {
  id: string; event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string | null;
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
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null; line_messages: { text: string | null; received_at: string | null; display_name: string | null } | null;
};
type EditableItem = {
  client_id: string; id?: string; event_type: string; event_date: string; campus: string; lesson_id: string;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string; status?: string;
};

const defaultReplyTemplates = [
  "ご連絡ありがとうございます。承知しました。本日の授業連絡として登録いたします。",
  "ご連絡ありがとうございます。承知しました。担当にも共有いたします。",
  "承知しました。必要があればこちらで確認いたします。",
];

const reasonOptions = ["体調不良", "発熱", "学校行事", "通院", "家庭都合", "部活動", "交通事情", "電車遅延", "到着予定あり", "振替希望", "欠席連絡", "遅刻連絡"];
const eventTypeOptions = [
  { value: "absence", label: "欠席" },
  { value: "late", label: "遅刻" },
  { value: "reschedule_request", label: "振替希望" },
  { value: "other", label: "その他" },
];
function eventTypeLabel(value: string) { return eventTypeOptions.find((option) => option.value === value)?.label ?? "その他"; }
function fallbackReason(value: string) { return value === "late" ? "遅刻連絡" : value === "reschedule_request" ? "振替希望" : value === "other" ? "連絡" : "欠席連絡"; }

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

function initialItems(candidate: Candidate, initialCampus: string) {
  const source = (candidate.attendance_candidate_items ?? []).length > 0 ? candidate.attendance_candidate_items! : [{
    id: "", event_type: candidate.event_type, event_date: candidate.event_date, lesson_id: candidate.lesson_id,
    suggested_subject: candidate.suggested_subject, suggested_class_name: candidate.suggested_class_name,
    ai_summary: candidate.ai_summary, status: candidate.status, notion_error: candidate.notion_error, lessons: candidate.lessons,
  }];
  return source.map((item) => ({
    client_id: item.id || makeClientId(),
    id: item.id || undefined,
    event_type: item.event_type || candidate.event_type || "absence",
    event_date: item.event_date ?? "",
    campus: item.lessons?.campus ?? initialCampus,
    lesson_id: item.lesson_id ?? "",
    suggested_subject: item.suggested_subject,
    suggested_class_name: item.suggested_class_name,
    ai_summary: item.ai_summary ?? fallbackReason(item.event_type || candidate.event_type),
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
  const [viewMode, setViewMode] = useState<"pending" | "done">("pending");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const query = viewMode === "done" ? "status=done&days=5" : "status=pending";
    const response = await fetch(`/api/attendance/candidates?${query}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "候補を取得できませんでした");
    setCandidates(body.candidates ?? []);
  }, [viewMode]);
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
      setMessage(`${body.processed}件を解析し、連絡候補${body.candidates}件を追加しました。対象外${body.ignored}件、失敗${body.failed}件です。`);
      if (viewMode !== "pending") setViewMode("pending");
      else await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <main className="shell" style={{ maxWidth: 1180 }}>
    <p className="eyebrow">Attendance review</p>
    <h1>欠席・遅刻連絡の確認</h1>
    <p>LINEの確認作業に近い流れで、返信文案とNotion登録内容を確認できます。</p>
    <section className="panel" style={{ padding: 16, marginTop: 20, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: 6, minWidth: 220 }}><span>確認者名</span><input style={inputStyle} value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="例：吉川" /></label>
      <button style={buttonStyle} disabled={busy} onClick={analyze}>{busy ? "解析中..." : "新しいLINEを解析"}</button>
      <button type="button" style={viewMode === "pending" ? buttonStyle : ghostButtonStyle} onClick={() => setViewMode("pending")}>未対応</button>
      <button type="button" style={viewMode === "done" ? buttonStyle : ghostButtonStyle} onClick={() => setViewMode("done")}>対応済み（直近5日）</button>
      <button type="button" style={ghostButtonStyle} onClick={() => void load()}>更新</button>
      {message && <p style={{ flexBasis: "100%" }}>{message}</p>}
    </section>
    <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
      {candidates.length === 0 && <section className="panel" style={{ padding: 24 }}>{viewMode === "done" ? "直近5日の対応済み連絡はありません。" : "未確認の連絡候補はありません。"}</section>}
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
  const [items, setItems] = useState<EditableItem[]>(() => initialItems(candidate, initialCampus));
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
    setItems((current) => current.map((item) => ({ ...item, lesson_id: "" })));
  }

  function addItem() {
    const previous = items[items.length - 1];
    setItems((current) => [...current, {
      client_id: makeClientId(),
      event_type: previous?.event_type ?? candidate.event_type ?? "absence",
      event_date: previous?.event_date ?? candidate.event_date ?? "",
      campus: previous?.campus ?? initialCampus,
      lesson_id: "",
      suggested_subject: null,
      suggested_class_name: null,
      ai_summary: previous?.ai_summary ?? fallbackReason(candidate.event_type),
    }]);
  }

  function removeItem(clientId: string) {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.client_id !== clientId));
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
        student_number: studentNumber,
        event_date: firstItem?.event_date || null,
        event_type: firstItem?.event_type || candidate.event_type,
        lesson_id: firstItem?.lesson_id || null,
        ai_summary: firstItem?.ai_summary?.trim() || fallbackReason(firstItem?.event_type || candidate.event_type),
        items: items.map((item) => ({
          event_type: item.event_type,
          event_date: item.event_date || null,
          lesson_id: item.lesson_id || null,
          suggested_subject: item.suggested_subject,
          suggested_class_name: item.suggested_class_name,
          ai_summary: item.ai_summary.trim() || fallbackReason(item.event_type),
        })),
      }),
    });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
  }

  async function confirmCandidate() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!studentNumber) { setCardMessage("名前を選択してください。"); return; }
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

    <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,220px) minmax(0,1fr)", gap: 12, marginBottom: 12 }}>
      <label style={fieldStyle}>名前<select style={inputStyle} value={studentNumber} onChange={(event) => selectStudent(event.target.value)}><option value="">要選択</option>{studentOptions.map((student) => {
        const suggestion = suggestions.find((item) => item.student_number === student.student_number);
        const suffix = suggestion ? ` / ${suggestion.reason}` : "";
        return <option key={student.student_number} value={student.student_number}>{student.grade} {student.student_name}{suffix}</option>;
      })}</select></label>
      <label style={fieldStyle}>担任<div style={readonlyStyle}>{selectedStudent?.homeroom_teacher ?? "未設定"}</div></label>
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
          <div style={{ display: "grid", gridTemplateColumns: "110px 120px 130px minmax(220px,1fr) 42px", gap: 8, alignItems: "end" }}>
            <label style={fieldStyle}>日付<input style={inputStyle} type="date" value={item.event_date} disabled={registered} onChange={(event) => updateItem(item.client_id, { event_date: event.target.value, lesson_id: "" })} /></label>
            <label style={fieldStyle}>種別<select style={inputStyle} value={item.event_type} disabled={registered} onChange={(event) => updateItem(item.client_id, { event_type: event.target.value, ai_summary: !item.ai_summary.trim() || item.ai_summary === fallbackReason(item.event_type) ? fallbackReason(event.target.value) : item.ai_summary })}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label style={fieldStyle}>校舎<select style={inputStyle} value={item.campus} disabled={registered} onChange={(event) => updateItem(item.client_id, { campus: event.target.value, lesson_id: currentLesson?.campus === event.target.value ? item.lesson_id : "" })}><option value="">要選択</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
            <label style={fieldStyle}>理由<div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(item.ai_summary) ? item.ai_summary : ""} disabled={registered} onChange={(event) => { if (event.target.value) updateItem(item.client_id, { ai_summary: event.target.value }); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={item.ai_summary} disabled={registered} onChange={(event) => updateItem(item.client_id, { ai_summary: event.target.value })} placeholder="例：体調不良" /></div></label>
            <button type="button" style={{ ...ghostButtonStyle, height: 40, padding: 0 }} disabled={registered || items.length <= 1} onClick={() => removeItem(item.client_id)}>削除</button>
          </div>
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
