"use client";

import { useEffect, useState } from "react";
import { lessonsForPeriodProposal } from "@/lib/attendance-period-proposal.mjs";
import type { PeriodLesson } from "./period-lesson-picker";

export type PeriodProposal = { start: string; end: string; eventType: string; reason: string; subject: string; className: string; arrival: string };

export default function AutoPeriodReview({ studentNumber, studentName, proposal, disabled, onConfirm, onManual }: {
  studentNumber: string; studentName: string; proposal: PeriodProposal; disabled: boolean;
  onConfirm: (lessons: PeriodLesson[], reason: string, eventType: "absence" | "late") => Promise<void>; onManual: () => void;
}) {
  const [lessons, setLessons] = useState<PeriodLesson[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [eventType, setEventType] = useState<"absence" | "late">(proposal.eventType === "late" ? "late" : "absence");
  const [reason, setReason] = useState(proposal.reason || (proposal.eventType === "late" ? "遅刻連絡" : "欠席連絡"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        setLoading(true); setError(""); setLessons([]); setExcluded([]);
        const params = new URLSearchParams({ student_number: studentNumber, date_from: proposal.start, date_to: proposal.end });
        const response = await fetch(`/api/attendance/lessons?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "授業を取得できませんでした。");
        if (!controller.signal.aborted) setLessons(lessonsForPeriodProposal(body.lessons ?? [], proposal));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [studentNumber, proposal, reload]);
  const selected = lessons.filter((lesson) => !excluded.includes(lesson.id));
  const kind = eventType === "late" ? "遅刻" : "欠席";
  return <fieldset disabled={disabled} style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: 12, background: "var(--accent-soft)", padding: 16, display: "grid", gap: 12 }}>
    <legend style={{ fontWeight: 800 }}>期間の{kind}をまとめて登録</legend>
    <strong>{studentName}：{proposal.start} 〜 {proposal.end}</strong>
    <label style={{ display: "grid", gap: 6 }}>まとめて登録する種別
      <select value={eventType} onChange={(event) => {
        const next = event.target.value === "late" ? "late" : "absence";
        setEventType(next);
        if (!reason.trim() || ["欠席", "欠席連絡", "遅刻", "遅刻連絡"].includes(reason.trim())) setReason(next === "late" ? "遅刻連絡" : "欠席連絡");
      }} style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 6, background: "white" }}><option value="absence">欠席</option><option value="late">遅刻</option></select>
    </label>
    <p style={{ margin: 0 }}>連絡の期間と受講クラスから、対象の授業を調べました。この内容でまとめて{kind}登録しますか？</p>
    {loading ? <p role="status">期間内の授業を確認しています…</p> : error ? <div role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>再取得</button></div> : <>
      {!lessons.length ? <p role="status">対象の授業が見つかりません。選択した生徒・連絡の期間・受講クラスを確認してください。「日付・授業を自分で修正」からも設定できます。</p> : <>
        <div style={{ display: "grid", gap: 8 }}>{lessons.map((lesson) => <label key={lesson.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "white", padding: 12, borderRadius: 8 }}>
          <input type="checkbox" checked={!excluded.includes(lesson.id)} onChange={(event) => setExcluded((current) => event.target.checked ? current.filter((id) => id !== lesson.id) : [...current, lesson.id])} />
          <span><strong>{lesson.lesson_date}（{new Intl.DateTimeFormat("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" }).format(new Date(`${lesson.lesson_date}T00:00:00Z`))}）</strong><br />{lesson.label} / {lesson.campus} / {lesson.start_time}</span>
        </label>)}</div>
        <p style={{ margin: 0, fontSize: 13 }}>授業がない日は登録しません。対象外の授業だけチェックを外してください。</p>
        <label style={{ display: "grid", gap: 6 }}>まとめて登録する理由<input value={reason} onChange={(event) => setReason(event.target.value)} style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 6 }} /></label>
        {eventType === "late" && proposal.arrival && <p>到着予定：{proposal.arrival}</p>}
        <button type="button" disabled={!selected.length || selected.length > 80 || !reason.trim()} onClick={() => void onConfirm(selected, reason.trim(), eventType)} style={{ background: "var(--accent)", color: "white", border: 0, borderRadius: 8, padding: 12, fontWeight: 800 }}>{disabled ? "まとめて登録中…" : `この${selected.length}授業をまとめて${kind}登録`}</button>
        {selected.length > 80 && <p role="alert">1回に登録できるのは80授業までです。対象を減らしてください。</p>}
      </>}
    </>}
    <button type="button" onClick={onManual} style={{ background: "white", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>日付・授業を自分で修正</button>
  </fieldset>;
}
