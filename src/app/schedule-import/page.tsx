"use client";

import { useState } from "react";
import { readSchedulePreview, scheduleFieldLabels } from "@/lib/schedule-preview.mjs";

type Lesson = { lesson_date: string; campus: string; classroom: string; start_time: string; label: string; teacher_name?: string };
type Change = { kind: string; before: Lesson | Lesson[] | null; after: Lesson | Lesson[] | null; changedFields: string[]; linkedRecords: number };
type Report = { month: string; generatedAt: string; source: { file: string }; summary: Record<string, number>; warnings: string[]; changes: Change[]; lessons: Lesson[] };
const kinds: Record<string, string> = { add: "追加", update: "変更", remove: "原本に見当たらない", ambiguous: "対応の確認が必要" };
const labels: Record<string, string> = { existing: "現在の登録", incoming: "原本の授業", unchanged: "変更なし", add: "追加", update: "変更", remove: "原本に見当たらない", ambiguous: "対応確認" };
function describe(value: Lesson | Lesson[] | null): string {
  if (!value) return "—";
  if (Array.isArray(value)) return value.map(describe).join("\n");
  return `${value.lesson_date} ${value.start_time}\n${value.campus} ${value.classroom}教室 ${value.label}\n担当: ${value.teacher_name || "未判定"}`;
}
export default function ScheduleImportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("all");
  const [campus, setCampus] = useState("all");
  const [showLessons, setShowLessons] = useState(false);
  async function openFile(file?: File) {
    setReport(null); setError(""); setKind("all"); setCampus("all");
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("確認ファイルは20MB以内にしてください。");
      setReport(readSchedulePreview(JSON.parse(await file.text())) as Report);
    } catch (e) { setError(e instanceof Error ? e.message : "ファイルを読み取れませんでした。"); }
  }
  return <main className="shell"><section className="panel">
    <p className="eyebrow">授業管理</p><h1>授業スケジュール取込</h1>
    <p>OneDriveのスケジュール原本と、教室に表示する授業の差分を確認します。</p>
    <p><strong>現在は取込前の確認機能です。本番への登録・変更・削除は行いません。</strong></p>
    <label style={{ display: "grid", gap: 8, margin: "20px 0" }}>取込処理で作成した確認ファイルを開く
      <input type="file" accept=".json,application/json" onChange={(e) => void openFile(e.target.files?.[0])} /></label>
    <p>ファイルの内容はこのブラウザ内で表示します。サーバーへ送信せず、画面を閉じると表示を終了します。</p>
    {!report && <p>確認ファイルは「【完成版】授業日誌システム」のクラウド原本を読む専用処理で作成します。定期取得と本番反映の連携は未接続です。</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <h2>{report.month} の確認結果</h2><p>原本: {report.source.file}<br />確認日時: {new Date(report.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）</p>
      <p>これは確認日時点の結果です。反映前には原本と本番データを再確認します。</p>
      <dl style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>{Object.entries(report.summary).map(([key, count]) => <div key={key}><dt>{labels[key]}</dt><dd style={{ margin: 0, fontSize: "1.5rem" }}>{count}件</dd></div>)}</dl>
      {report.warnings.length > 0 && <ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <label>表示対象 <select aria-label="表示対象" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">差分すべて</option>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {report.changes.length === 0 ? <p>原本と登録済み授業は一致しています。</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}><thead><tr>{["区分", "現在の登録", "原本", "変更項目", "関連記録数"].map((s) => <th key={s} style={{ textAlign: "left", padding: 8 }}>{s}</th>)}</tr></thead><tbody>
        {report.changes.filter((c) => kind === "all" || c.kind === kind).map((c, i) => <tr key={i} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{kinds[c.kind]}</td><td style={{ padding: 8, whiteSpace: "pre-line" }}>{describe(c.before)}</td><td style={{ padding: 8, whiteSpace: "pre-line" }}>{describe(c.after)}</td><td>{c.changedFields.map((f) => scheduleFieldLabels[f as keyof typeof scheduleFieldLabels] ?? f).join("、") || "—"}</td><td>{c.linkedRecords}</td></tr>)}
      </tbody></table></div>}
      <p>関連記録数は欠席・遅刻の確定記録と候補の合計です。人数とは異なります。</p>
      <button type="button" onClick={() => setShowLessons(!showLessons)}>{showLessons ? "授業一覧を閉じる" : "原本の授業一覧を見る"}</button>
      {showLessons && <><label style={{ marginLeft: 12 }}>校舎 <select aria-label="校舎" value={campus} onChange={(e) => setCampus(e.target.value)}><option value="all">全校舎</option><option>本校</option><option>南教室</option></select></label><ul>{report.lessons.filter((r) => campus === "all" || r.campus === campus).map((r, i) => <li key={i}>{describe(r).replaceAll("\n", " ／ ")}</li>)}</ul></>}
    </>}
  </section></main>;
}
