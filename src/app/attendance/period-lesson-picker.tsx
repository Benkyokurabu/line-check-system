"use client";

import { useEffect, useRef, useState } from "react";
import { attendanceRangeDates } from "@/lib/attendance-date-range.mjs";

export type PeriodLesson = {
  id: string; lesson_date: string; label: string; campus: string | null; start_time: string | null;
  enrolled?: boolean; enrollment_campus?: string | null; subject?: string | null; class_name?: string | null;
  broadcast_group?: string | null;
};
const field = { display: "grid", gap: 6 } as const;
const input = { padding: 9, border: "1px solid var(--line)", borderRadius: 6, background: "white", minWidth: 0 } as const;
const button = { ...input, cursor: "pointer", fontWeight: 700 } as const;

export default function PeriodLessonPicker({ studentNumber, initialDate, selected, onChange, disabled = false }: {
  studentNumber: string; initialDate: string; selected: PeriodLesson[]; onChange: (lessons: PeriodLesson[]) => void; disabled?: boolean;
}) {
  const [start, setStart] = useState(initialDate);
  const [end, setEnd] = useState(initialDate);
  const [lessons, setLessons] = useState<PeriodLesson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function invalidate() {
    controller.current?.abort();
    setLessons([]); setLoaded(false); setLoading(false); setMessage(""); onChange([]);
  }
  async function preview() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoaded(false); setLessons([]); onChange([]); setMessage("");
    try {
      attendanceRangeDates(start, end);
      if (!studentNumber) throw new Error("先に生徒を選択してください。");
      setLoading(true);
      const params = new URLSearchParams({ date_from: start, date_to: end, student_number: studentNumber });
      const response = await fetch(`/api/attendance/lessons?${params}`, { signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "授業一覧を取得できませんでした。");
      if (request.signal.aborted) return;
      const rows = (body.lessons ?? []) as PeriodLesson[];
      setLessons(rows); onChange(rows.filter((lesson) => !lesson.broadcast_group)); setLoaded(true);
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  return <fieldset disabled={disabled} style={{ minWidth: 0, margin: 0, padding: 12, border: "1px solid #b7d7c2", borderRadius: 8, background: "#f2fbf5" }}>
    <legend style={{ fontWeight: 800 }}>期間内の授業を選択</legend>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
      <label style={field}>開始日<input style={input} type="date" value={start} onChange={(event) => { invalidate(); setStart(event.target.value); }} /></label>
      <label style={field}>終了日<input style={input} type="date" min={start} value={end} onChange={(event) => { invalidate(); setEnd(event.target.value); }} /></label>
      <button type="button" style={button} disabled={loading || !studentNumber} onClick={() => void preview()}>{loading ? "授業を確認中…" : "期間内の授業を表示"}</button>
    </div>
    <p style={{ fontSize: 13 }}>開始日・終了日を含む期間の、受講中の授業を選択します。対象外の授業はチェックを外せます。</p>
    {message && <p role="alert">{message}</p>}
    {loaded && <>
      <p role="status" style={{ fontWeight: 700 }}>{new Set(selected.map((lesson) => lesson.lesson_date)).size}日・{selected.length}授業を選択中</p>
      {!lessons.length ? <p>期間内に受講中の授業が見つかりません。授業予定・受講クラスの登録を確認してください。</p> : <>
        <p style={{ fontSize: 13 }}>受講授業がない日は登録しません。配信授業は日付ごとに実際の配信元を1校舎だけ選んでください。未登録の授業や振替は、1日ずつの登録で授業を選択できます。</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}><button type="button" style={button} onClick={() => onChange(lessons.filter((lesson) => !lesson.broadcast_group || selected.some((row) => row.id === lesson.id)))}>通常授業をすべて選択</button><button type="button" style={button} onClick={() => onChange([])}>すべて解除</button></div>
        <div style={{ display: "grid", gap: 6, maxHeight: 340, overflowY: "auto" }}>{lessons.map((lesson) => <label key={lesson.id} style={{ display: "flex", alignItems: "center", gap: 8, background: selected.some((row) => row.id === lesson.id) ? "#dcfce7" : "white", border: selected.some((row) => row.id === lesson.id) ? "2px solid #16a34a" : "1px solid var(--line)", padding: 10, borderRadius: 6 }}>
          <input type="checkbox" checked={selected.some((row) => row.id === lesson.id)} onChange={(event) => {
            const ids = new Set(selected.filter((row) => !lesson.broadcast_group || row.broadcast_group !== lesson.broadcast_group).map((row) => row.id));
            if (event.target.checked) ids.add(lesson.id); else ids.delete(lesson.id);
            onChange(lessons.filter((row) => ids.has(row.id)));
          }} />
          <span>{lesson.lesson_date}（{new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" }).format(new Date(`${lesson.lesson_date}T00:00:00Z`))}） {lesson.start_time?.slice(0, 5)}　{lesson.label} / {lesson.broadcast_group ? `配信元 ${lesson.campus}` : lesson.campus}</span>
        </label>)}</div>
      </>}
    </>}
  </fieldset>;
}
