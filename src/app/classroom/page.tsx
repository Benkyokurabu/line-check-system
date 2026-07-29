"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Lesson = {
  id: string;
  lesson_date: string;
  start_time: string | null;
  label: string;
  campus: string | null;
  classroom: string | null;
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

type ClassroomResponse = {
  date: string;
  campus: string;
  classroom: string;
  lessons: Lesson[];
  selected_lesson: Lesson | null;
  events: ClassroomEvent[];
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
  padding: "14px 18px",
  background: "var(--accent)",
  color: "white",
  fontSize: "1rem",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "12px 16px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.95rem",
  fontWeight: 800,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "10px 12px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "1rem",
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatClock(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatShortTime(value: string | null | undefined) {
  if (!value) return "時刻未設定";
  const match = value.match(/(\d{1,2}:\d{2})/);
  return match?.[1] ?? value;
}

function formatConfirmedAt(value: string | null) {
  if (!value) return "確認時刻不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "確認時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
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

function getStoredSetting() {
  if (typeof window === "undefined") return { campus: "南教室", classroom: "2" };
  return {
    campus: localStorage.getItem("classroom.campus") || "南教室",
    classroom: localStorage.getItem("classroom.classroom") || "2",
  };
}

export default function ClassroomPage() {
  const [storedSetting] = useState(getStoredSetting);
  const [campus, setCampus] = useState(storedSetting.campus);
  const [classroom, setClassroom] = useState(storedSetting.classroom);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [keepVisible, setKeepVisible] = useState(false);
  const [remaining, setRemaining] = useState(180);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const [manuallySelectedLessonId, setManuallySelectedLessonId] = useState("");
  const [data, setData] = useState<ClassroomResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const classOptions = useMemo(() => classrooms[campus as keyof typeof classrooms] ?? classrooms["南教室"], [campus]);
  const effectiveClassroom = classOptions.includes(classroom as never) ? classroom : classOptions[0];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (lessonId = manuallySelectedLessonId) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ campus, classroom: effectiveClassroom, date: todayJst() });
      if (lessonId) query.set("lesson_id", lessonId);
      const response = await fetch(`/api/classroom/attendance?${query.toString()}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as ClassroomResponse;
      if (!response.ok) throw new Error(body.error ?? "教室表示を取得できませんでした");
      setData(body);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : String(error));
      setData(null);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [campus, effectiveClassroom, manuallySelectedLessonId]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load, visible]);

  useEffect(() => {
    if (!visible || keepVisible) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          setVisible(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [keepVisible, visible]);

  function saveSettings() {
    localStorage.setItem("classroom.campus", campus);
    localStorage.setItem("classroom.classroom", effectiveClassroom);
    setManuallySelectedLessonId("");
    setData(null);
    setSettingsOpen(false);
    if (visible) void load("");
  }

  function showAttendance() {
    setVisible(true);
    setCheckedAt(new Date());
    setRemaining(180);
    setManuallySelectedLessonId("");
    void load("");
  }

  function changeLesson(lessonId: string) {
    setManuallySelectedLessonId(lessonId);
    void load(lessonId);
  }

  const selectedLesson = data?.selected_lesson ?? null;
  const events = data?.events ?? [];

  return <main className="shell" style={{ maxWidth: 760, paddingTop: 42 }}>
    <section style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <p className="eyebrow">Classroom attendance</p>
          <h1 style={{ fontSize: "2.15rem", marginBottom: 8 }}>{campus} {effectiveClassroom}教室</h1>
          <p style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--foreground)" }}>現在 {formatClock(now)}</p>
        </div>
        <button type="button" style={ghostButtonStyle} onClick={() => setSettingsOpen((value) => !value)}>教室変更</button>
      </div>

      {settingsOpen && <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>校舎<select style={selectStyle} value={campus} onChange={(event) => { const nextCampus = event.target.value; setCampus(nextCampus); setClassroom((classrooms[nextCampus as keyof typeof classrooms] ?? classrooms["南教室"])[0]); }}><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>教室<select style={selectStyle} value={effectiveClassroom} onChange={(event) => setClassroom(event.target.value)}>{classOptions.map((room) => <option key={room} value={room}>{room}教室</option>)}</select></label>
        </div>
        <button type="button" style={buttonStyle} onClick={saveSettings}>この教室で保存</button>
      </section>}

      {!visible && <section className="panel" style={{ padding: 22, display: "grid", gap: 14 }}>
        <p style={{ fontSize: "1rem" }}>確認ボタンを押した時だけ、確定済みの欠席・遅刻・早退を表示します。</p>
        <button type="button" style={{ ...buttonStyle, minHeight: 58, fontSize: "1.15rem" }} onClick={showAttendance}>欠席・遅刻を確認</button>
      </section>}

      {visible && <section className="panel" style={{ padding: 18, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong style={{ fontSize: "1.05rem" }}>確認表示 {checkedAt ? formatClock(checkedAt) : "--:--"}</strong>
            {!keepVisible && <span style={{ color: "var(--muted)", fontWeight: 700 }}>自動で隠すまで {remaining}秒</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={ghostButtonStyle} onClick={() => setKeepVisible((value) => { if (value) setRemaining(180); return !value; })}>{keepVisible ? "自動で隠す" : "自動で隠さない"}</button>
            <button type="button" style={ghostButtonStyle} onClick={() => setVisible(false)}>閉じる</button>
          </div>
        </div>

        {message && <div style={{ border: "1px solid #fca5a5", background: "#fef2f2", color: "#b42318", borderRadius: 8, padding: 12, fontWeight: 800 }}>{message}</div>}
        {data?.notion_warning && <div style={{ border: "1px solid #fdba74", background: "#fff7ed", color: "#9a3412", borderRadius: 8, padding: 12, fontWeight: 800 }}>{data.notion_warning}</div>}
        {loading && !data && <p>読み込み中...</p>}

        {data && <>
          {data.lessons.length > 1 && <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>表示する授業<select style={selectStyle} value={selectedLesson?.id ?? ""} onChange={(event) => changeLesson(event.target.value)}>{data.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{formatShortTime(lesson.start_time)} {lesson.label}</option>)}</select></label>}

          {selectedLesson ? <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, background: "#f7f7f4", display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: "0.9rem", fontWeight: 800 }}>表示中の授業</span>
            <strong style={{ fontSize: "1.25rem" }}>{formatShortTime(selectedLesson.start_time)} {selectedLesson.label}</strong>
            <span style={{ color: "var(--muted)", fontWeight: 700 }}>担当: {selectedLesson.teacher_name || "未設定"}</span>
          </div> : <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, fontSize: "1.15rem", fontWeight: 800 }}>{data.message ?? "本日の次の授業はありません"}</div>}

          {selectedLesson && events.length === 0 && <div style={{ border: "1px solid #b7d7c2", background: "#f2fbf5", color: "#087a3d", borderRadius: 8, padding: 18, fontSize: "1.2rem", fontWeight: 900 }}>欠席・遅刻連絡はありません</div>}

          {events.length > 0 && <div style={{ display: "grid", gap: 10 }}>
            {events.map((event) => <article key={event.id} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "white", padding: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: "1.28rem" }}>{event.student_name}</strong>
                <span style={{ ...eventTypeStyle(event.event_type), border: "1px solid", borderRadius: 999, padding: "5px 10px", fontWeight: 900 }}>{eventTypeLabel(event.event_type)}</span>
              </div>
              <div style={{ color: "var(--foreground)", fontSize: "1rem", lineHeight: 1.7 }}>
                {[event.reason, event.event_type === "late" && event.arrival_expected_time ? `${event.arrival_expected_time}頃到着予定` : null, event.note_for_classroom].filter(Boolean).join(" / ") || "詳細なし"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.9rem", fontWeight: 700 }}>確認 {formatConfirmedAt(event.confirmed_at)}</div>
            </article>)}
          </div>}

          <p style={{ fontSize: "0.85rem" }}>最終更新 {formatConfirmedAt(data.fetched_at)}</p>
        </>}
      </section>}
    </section>
  </main>;
}

