"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Lesson = {
  id: string;
  start_time: string | null;
  label: string;
  teacher_name: string | null;
};

type ClassroomEvent = {
  id: string;
  student_name: string;
  grade: string | null;
  event_type: string;
  reason: string | null;
  arrival_expected_time: string | null;
  note_for_classroom: string | null;
  confirmed_at: string | null;
};

type ClassroomMessage = {
  id: string;
  message: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
};

type ClassroomResponse = {
  date: string;
  campus: string;
  classroom: string;
  lessons: Lesson[];
  selected_lesson: Lesson | null;
  events: ClassroomEvent[];
  messages?: ClassroomMessage[];
  message: string | null;
  notion_warning?: string | null;
  fetched_at: string;
  error?: string;
};

const classrooms = {
  "本校": ["1", "2", "3", "4", "6", "7"],
  "南教室": ["1", "2", "3", "4", "5", "6"],
} as const;

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "10px 14px",
  background: "var(--accent)",
  color: "white",
  fontSize: "0.92rem",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "9px 12px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.86rem",
  fontWeight: 800,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.92rem",
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatShortTime(value: string | null | undefined) {
  if (!value) return "時刻未設定";
  const match = value.match(/(\d{1,2}:\d{2})/);
  return match?.[1] ?? value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function eventTypeLabel(value: string) {
  if (value === "late") return "遅刻";
  if (value === "early_leave") return "早退";
  return "欠席";
}

function eventTypeStyle(value: string): React.CSSProperties {
  if (value === "late") return { background: "#fff7ed", borderColor: "#fdba74", color: "#9a3412" };
  if (value === "early_leave") return { background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" };
  return { background: "#fef2f2", borderColor: "#fca5a5", color: "#b42318" };
}

export default function ClassroomOfficePage() {
  const [campus, setCampus] = useState("南教室");
  const [classroom, setClassroom] = useState("2");
  const [lessonId, setLessonId] = useState("");
  const [data, setData] = useState<ClassroomResponse | null>(null);
  const [messageText, setMessageText] = useState("");
  const [createdBy, setCreatedBy] = useState("事務部");
  const [expiresAt, setExpiresAt] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const classOptions = useMemo(() => classrooms[campus as keyof typeof classrooms] ?? classrooms["南教室"], [campus]);
  const effectiveClassroom = classOptions.includes(classroom as never) ? classroom : classOptions[0];

  const load = useCallback(async (nextLessonId = lessonId) => {
    setLoading(true);
    setNotice("");
    try {
      const params = new URLSearchParams({ campus, classroom: effectiveClassroom, date: todayJst() });
      if (nextLessonId) params.set("lesson_id", nextLessonId);
      const response = await fetch(`/api/classroom/attendance?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as ClassroomResponse;
      if (!response.ok) throw new Error(body.error ?? "教室情報を取得できませんでした");
      setData(body);
      if (!nextLessonId) setLessonId(body.selected_lesson?.id ?? "");
    } catch (error) {
      setData(null);
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [campus, effectiveClassroom, lessonId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function changeLesson(nextLessonId: string) {
    setLessonId(nextLessonId);
    await load(nextLessonId);
  }

  async function sendMessage() {
    setSending(true);
    setNotice("");
    try {
      const response = await fetch("/api/classroom/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campus,
          classroom: effectiveClassroom,
          message: messageText,
          created_by: createdBy,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "メッセージを登録できませんでした");
      setMessageText("");
      setNotice("教室メッセージを登録しました");
      await load(lessonId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  async function archiveMessage(id: string) {
    setNotice("");
    const response = await fetch("/api/classroom/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      setNotice(body.error ?? "メッセージを取り下げできませんでした");
      return;
    }
    setNotice("教室メッセージを取り下げました");
    await load(lessonId);
  }

  const events = data?.events ?? [];
  const messages = data?.messages ?? [];

  return <main className="shell" style={{ maxWidth: 980, paddingTop: 42 }}>
    <section style={{ display: "grid", gap: 18 }}>
      <div>
        <p className="eyebrow">Classroom office</p>
        <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>教室への連絡</h1>
        <p>教室ごとの欠席・遅刻・早退情報を確認し、事務部から教室画面へメッセージを出します。</p>
      </div>

      <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>校舎<select style={inputStyle} value={campus} onChange={(event) => { const nextCampus = event.target.value; setCampus(nextCampus); setClassroom((classrooms[nextCampus as keyof typeof classrooms] ?? classrooms["南教室"])[0]); setLessonId(""); }}><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>教室<select style={inputStyle} value={effectiveClassroom} onChange={(event) => { setClassroom(event.target.value); setLessonId(""); }}>{classOptions.map((room) => <option key={room} value={room}>{room}教室</option>)}</select></label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>授業<select style={inputStyle} value={lessonId} onChange={(event) => void changeLesson(event.target.value)}><option value="">自動選択</option>{(data?.lessons ?? []).map((lesson) => <option key={lesson.id} value={lesson.id}>{formatShortTime(lesson.start_time)} {lesson.label}</option>)}</select></label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="button" style={ghostButtonStyle} onClick={() => void load(lessonId)} disabled={loading}>{loading ? "更新中" : "更新"}</button></div>
        </div>
      </section>

      {notice && <div style={{ border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: 12, fontWeight: 800 }}>{notice}</div>}

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.78fr)", gap: 14, alignItems: "start" }}>
        <section className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <h2 style={{ fontSize: "1.2rem" }}>{campus} {effectiveClassroom}教室</h2>
            <span style={{ color: "var(--muted)", fontSize: "0.86rem", fontWeight: 800 }}>{formatDateTime(data?.fetched_at)}</span>
          </div>

          {data?.selected_lesson && <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "#f7f7f4", display: "grid", gap: 4 }}>
            <span style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 800 }}>表示中の授業</span>
            <strong>{formatShortTime(data.selected_lesson.start_time)} {data.selected_lesson.label}</strong>
            <span style={{ color: "var(--muted)", fontSize: "0.86rem", fontWeight: 700 }}>担当: {data.selected_lesson.teacher_name || "未設定"}</span>
          </div>}

          {!loading && data && !data.selected_lesson && <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, fontWeight: 800 }}>{data.message ?? "本日の授業はありません"}</div>}
          {loading && <p>読み込み中...</p>}

          {events.length === 0 && data?.selected_lesson && <div style={{ border: "1px solid #b7d7c2", background: "#f2fbf5", color: "#087a3d", borderRadius: 8, padding: 14, fontWeight: 900 }}>欠席・遅刻連絡はありません</div>}

          {events.length > 0 && <div style={{ display: "grid", gap: 10 }}>
            {events.map((event) => <article key={event.id} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "white", padding: 12, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: "1.08rem" }}>{event.student_name}</strong>
                <span style={{ ...eventTypeStyle(event.event_type), border: "1px solid", borderRadius: 999, padding: "4px 9px", fontWeight: 900 }}>{eventTypeLabel(event.event_type)}</span>
              </div>
              <div style={{ color: "var(--foreground)", fontSize: "0.94rem", lineHeight: 1.65 }}>
                {[event.reason, event.event_type === "late" && event.arrival_expected_time ? `${event.arrival_expected_time}頃到着予定` : null, event.note_for_classroom].filter(Boolean).join(" / ") || "詳細なし"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 700 }}>確認 {formatDateTime(event.confirmed_at)}</div>
            </article>)}
          </div>}
        </section>

        <section className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
          <h2 style={{ fontSize: "1.2rem" }}>教室メッセージ</h2>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>送信者<input style={inputStyle} value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} /></label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>表示期限<input style={inputStyle} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>メッセージ<textarea style={{ ...inputStyle, minHeight: 104, resize: "vertical", lineHeight: 1.6 }} value={messageText} maxLength={500} onChange={(event) => setMessageText(event.target.value)} placeholder="例: 休み時間に事務室までプリントを取りに来てください。" /></label>
          <button type="button" style={buttonStyle} onClick={sendMessage} disabled={sending}>{sending ? "登録中" : "この教室へ出す"}</button>

          <div style={{ display: "grid", gap: 8 }}>
            <strong>表示中のメッセージ</strong>
            {messages.length === 0 && <p style={{ fontSize: "0.9rem" }}>現在表示中のメッセージはありません。</p>}
            {messages.map((item) => <article key={item.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, fontWeight: 800 }}>{item.message}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 700 }}>{item.created_by || "事務部"} / {formatDateTime(item.created_at)}{item.expires_at ? ` / 期限 ${formatDateTime(item.expires_at)}` : ""}</div>
              <button type="button" style={ghostButtonStyle} onClick={() => void archiveMessage(item.id)}>取り下げ</button>
            </article>)}
          </div>
        </section>
      </section>
    </section>
  </main>;
}