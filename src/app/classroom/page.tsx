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

type ClassroomMessage = {
  id: string;
  message: string;
  created_by: string | null;
  expires_at: string | null;
  created_at: string;
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
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const classrooms = {
  "本校": ["1", "2", "3", "4", "6", "7"],
  "南教室": ["1", "2", "3", "4", "5", "6"],
} as const;

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "7px 9px",
  background: "var(--accent)",
  color: "white",
  fontSize: "0.74rem",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 8px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.7rem",
  fontWeight: 800,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 8px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.74rem",
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState("");
  const [isStandalone, setIsStandalone] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const classOptions = useMemo(() => classrooms[campus as keyof typeof classrooms] ?? classrooms["南教室"], [campus]);
  const effectiveClassroom = classOptions.includes(classroom as never) ? classroom : classOptions[0];

  useEffect(() => {
    document.title = "遅刻・欠席確認";
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const standaloneTimer = window.setTimeout(() => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        ((window.navigator as Navigator & { standalone?: boolean }).standalone === true);
      setIsStandalone(standalone);
    }, 0);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallHelp("");
    };
    const handleAppInstalled = () => {
      setIsStandalone(true);
      setInstallPrompt(null);
      setInstallHelp("アプリとして追加済みです");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.clearTimeout(standaloneTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
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
  async function installApp() {
    if (!installPrompt) {
      setInstallHelp("Chrome/Edge右上のメニューから「アプリとしてインストール」を選んでください。表示されない場合は、通常ウィンドウでこのページを30秒ほど開いてから再度確認してください。");
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallHelp(choice.outcome === "accepted" ? "インストールを開始しました" : "インストールはキャンセルされました");
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
  const classroomMessages = data?.messages ?? [];

  return <main className="shell" style={{ maxWidth: 500, padding: "10px 10px" }}>
    <section style={{ display: "grid", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 5 }}>
        <div>
          <p className="eyebrow" style={{ fontSize: "0.58rem", marginBottom: 3 }}>Classroom attendance</p>
          <h1 style={{ fontSize: "1.08rem", marginBottom: 2 }}>{campus} {effectiveClassroom}教室</h1>
          <p style={{ fontSize: "0.74rem", fontWeight: 800, color: "var(--foreground)" }}>現在 {formatClock(now)}</p>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!isStandalone && <button type="button" style={ghostButtonStyle} onClick={installApp}>アプリ化</button>}
          <button type="button" style={ghostButtonStyle} onClick={() => setSettingsOpen((value) => !value)}>教室変更</button>
        </div>
      </div>

      {installHelp && <div style={{ border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: 10, fontSize: "0.7rem", fontWeight: 800, lineHeight: 1.45 }}>{installHelp}</div>}

      {settingsOpen && <section className="panel" style={{ padding: 12, display: "grid", gap: 5 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <label style={{ display: "grid", gap: 5, fontWeight: 800 }}>校舎<select style={selectStyle} value={campus} onChange={(event) => { const nextCampus = event.target.value; setCampus(nextCampus); setClassroom((classrooms[nextCampus as keyof typeof classrooms] ?? classrooms["南教室"])[0]); }}><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
          <label style={{ display: "grid", gap: 5, fontWeight: 800 }}>教室<select style={selectStyle} value={effectiveClassroom} onChange={(event) => setClassroom(event.target.value)}>{classOptions.map((room) => <option key={room} value={room}>{room}教室</option>)}</select></label>
        </div>
        <button type="button" style={buttonStyle} onClick={saveSettings}>この教室で保存</button>
      </section>}

      {!visible && <section className="panel" style={{ padding: 8, display: "grid", gap: 4 }}>
        <p style={{ fontSize: "0.74rem" }}>確認ボタンを押した時だけ、確定済みの欠席・遅刻・早退を表示します。</p>
        <button type="button" style={{ ...buttonStyle, minHeight: 34, fontSize: "0.68rem" }} onClick={showAttendance}>欠席・遅刻を確認</button>
      </section>}

      {visible && <section className="panel" style={{ padding: 8, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: "0.78rem" }}>確認表示 {checkedAt ? formatClock(checkedAt) : "--:--"}</strong>
            {!keepVisible && <span style={{ color: "var(--muted)", fontWeight: 700 }}>自動で隠すまで {remaining}秒</span>}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button type="button" style={ghostButtonStyle} onClick={() => setKeepVisible((value) => { if (value) setRemaining(180); return !value; })}>{keepVisible ? "自動で隠す" : "自動で隠さない"}</button>
            <button type="button" style={ghostButtonStyle} onClick={() => setVisible(false)}>閉じる</button>
          </div>
        </div>

        {message && <div style={{ border: "1px solid #fca5a5", background: "#fef2f2", color: "#b42318", borderRadius: 8, padding: 12, fontWeight: 800 }}>{message}</div>}
        {data?.notion_warning && <div style={{ border: "1px solid #fdba74", background: "#fff7ed", color: "#9a3412", borderRadius: 8, padding: 12, fontWeight: 800 }}>{data.notion_warning}</div>}
        {classroomMessages.length > 0 && <section style={{ border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: 8, display: "grid", gap: 4 }}>
          <strong style={{ fontSize: "0.86rem" }}>事務部から</strong>
          {classroomMessages.map((item) => <article key={item.id} style={{ display: "grid", gap: 3 }}>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45, fontSize: "0.78rem", fontWeight: 900 }}>{item.message}</div>
            <div style={{ fontSize: "0.64rem", fontWeight: 700 }}>{item.created_by || "事務部"} / {formatDateTime(item.created_at)}{item.expires_at ? ` / 期限 ${formatDateTime(item.expires_at)}` : ""}</div>
          </article>)}
        </section>}
        {loading && !data && <p>読み込み中...</p>}

        {data && <>
          {data.lessons.length > 1 && <label style={{ display: "grid", gap: 5, fontWeight: 800 }}>表示する授業<select style={selectStyle} value={selectedLesson?.id ?? ""} onChange={(event) => changeLesson(event.target.value)}>{data.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{formatShortTime(lesson.start_time)} {lesson.label}</option>)}</select></label>}

          {selectedLesson ? <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, background: "#f7f7f4", display: "grid", gap: 4 }}>
            <span style={{ color: "var(--muted)", fontSize: "0.68rem", fontWeight: 800 }}>表示中の授業</span>
            <strong style={{ fontSize: "0.84rem" }}>{formatShortTime(selectedLesson.start_time)} {selectedLesson.label}</strong>
            <span style={{ color: "var(--muted)", fontWeight: 700 }}>担当: {selectedLesson.teacher_name || "未設定"}</span>
          </div> : <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, fontSize: "0.8rem", fontWeight: 800 }}>{data.message ?? "本日の次の授業はありません"}</div>}

          {selectedLesson && events.length === 0 && <div style={{ border: "1px solid #b7d7c2", background: "#f2fbf5", color: "#087a3d", borderRadius: 8, padding: 10, fontSize: "0.84rem", fontWeight: 900 }}>欠席・遅刻連絡はありません</div>}

          {events.length > 0 && <div style={{ display: "grid", gap: 5 }}>
            {events.map((event) => <article key={event.id} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "white", padding: 8, display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontSize: "0.86rem" }}>{event.student_name}</strong>
                <span style={{ ...eventTypeStyle(event.event_type), border: "1px solid", borderRadius: 999, padding: "2px 6px", fontWeight: 900 }}>{eventTypeLabel(event.event_type)}</span>
              </div>
              <div style={{ color: "var(--foreground)", fontSize: "0.74rem", lineHeight: 1.45 }}>
                {[event.reason, event.event_type === "late" && event.arrival_expected_time ? `${event.arrival_expected_time}頃到着予定` : null, event.note_for_classroom].filter(Boolean).join(" / ") || "詳細なし"}
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 700 }}>確認 {formatConfirmedAt(event.confirmed_at)}</div>
            </article>)}
          </div>}

          <p style={{ fontSize: "0.64rem" }}>最終更新 {formatConfirmedAt(data.fetched_at)}</p>
        </>}
      </section>}
    </section>
  </main>;
}

