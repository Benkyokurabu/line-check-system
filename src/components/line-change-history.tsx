"use client";
import { useEffect, useState } from "react";
import { relationLabel } from "@/lib/line-contact-registration.mjs";

type Snapshot = { alias_name?: string | null; group_name?: string | null; student_number?: string | null; student_name?: string | null; relation?: string | null; lessons?: Array<{ lesson_id?: string | null }> };
type Change = { id: string; kind: string; action: string; actor: string | null; created_at: string; candidate_id?: string; message_text?: string | null; before_value: Snapshot | null; after_value: Snapshot | null };
const labels: Record<string, string> = { name: "表示名の変更", group: "グループの変更", registration: "LINE登録先の変更", attendance: "連絡の対象生徒・授業の変更" };
const button = { padding: "10px 14px", border: "1px solid #adc5ca", borderRadius: 7, background: "white", color: "#194e56", cursor: "pointer", font: "inherit" };
function snapshotText(kind: string, snapshot: Snapshot | null) {
  if (!snapshot) return "記録なし・未登録";
  if (kind === "name") return snapshot.alias_name || "未登録";
  if (kind === "group") return snapshot.group_name || "未登録";
  const student = snapshot.student_name || snapshot.student_number || "未選択";
  if (kind === "attendance") return `${student} / 授業 ${(snapshot.lessons ?? []).filter(lesson => lesson.lesson_id).length}件`;
  return [student, snapshot.relation && relationLabel(snapshot.relation), snapshot.alias_name].filter(Boolean).join(" / ");
}
export default function LineChangeHistory({ userId, candidateId, refreshKey }: { userId?: string | null; candidateId?: string; refreshKey?: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Change[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || (!userId && !candidateId)) return;
    const controller = new AbortController();
    const url = userId ? `/api/admin/contacts/${encodeURIComponent(userId)}/history${candidateId ? `?candidate_id=${encodeURIComponent(candidateId)}` : ""}` : `/api/attendance/candidates/${candidateId}/history`;
    fetch(url, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "変更履歴を取得できませんでした");
      const rows = body.history ?? [];
      if (userId) return rows as Change[];
      return rows.map((row: { id: number; actor: string | null; created_at: string; before_student_number: string | null; after_student_number: string | null; before_lessons: Snapshot["lessons"]; after_lessons: Snapshot["lessons"] }) => ({
        id: `attendance:${row.id}`, kind: "attendance", action: "updated", actor: row.actor, created_at: row.created_at,
        before_value: { student_number: row.before_student_number, lessons: row.before_lessons }, after_value: { student_number: row.after_student_number, lessons: row.after_lessons },
      }));
    }).then(rows => { if (!controller.signal.aborted) { setHistory(rows); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, userId, candidateId, refreshKey, attempt]);
  if (!userId && !candidateId) return null;
  return <section aria-label="登録・対象生徒の変更履歴" style={{ marginTop: 12, display: "grid", gap: 8, minWidth: 0, overflowWrap: "anywhere" }}>
    <button type="button" style={button} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) { setLoading(true); setHistory([]); setError(""); } }}>{open ? "変更履歴を閉じる" : "登録・対象生徒の変更履歴"}</button>
    {open && <div aria-live="polite" style={{ display: "grid", gap: 8 }}>
      <small>表示名・LINE登録先・{candidateId ? "今回の連絡" : "連絡ごと"}の対象変更を、新しい順に直近50件表示します。</small>
      {loading && <p>履歴を読み込み中…</p>}
      {error ? <div role="alert">{error}<button type="button" style={button} onClick={() => { setLoading(true); setAttempt(attempt + 1); }}>履歴の取得を再試行</button></div> : !loading && history.length === 0 ? <p>変更履歴はありません。</p> : history.map(change => <article key={change.id} style={{ padding: 10, border: "1px solid #cbd5d9", borderRadius: 7 }}>
        <strong>{labels[change.kind] ?? "登録の変更"}{change.action === "revoked" ? "（登録解除）" : ""}</strong>
        <div>{new Date(change.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} / {change.actor || "担当者の記録なし"}</div>
        {change.message_text && <p>対象の連絡：{change.message_text}</p>}
        <div>変更前：{snapshotText(change.kind, change.before_value)}</div>
        <div>変更後：{snapshotText(change.kind, change.after_value)}</div>
      </article>)}
    </div>}
  </section>;
}
