"use client";

import { useEffect, useRef, useState } from "react";
import { scheduleFieldLabels } from "@/lib/schedule-preview.mjs";

type Lesson = { lesson_date: string; campus: string; classroom: string; start_time: string; label: string; teacher_name?: string };
type Change = { kind: string; before: Lesson | Lesson[] | null; after: Lesson | Lesson[] | null; changedFields: string[]; linkedRecords: number };
type Report = { month: string; generatedAt: string; source: { file: string }; summary: Record<string, number>; warnings: string[]; changes: Change[]; lessons: Lesson[] };
type SyncRun = { id: string; month: string; status: string; message: string; started_at: string; finished_at: string | null; source: { file?: string } | null };
type SyncStatus = { enabled: boolean; stale: boolean; months: string[]; runs: SyncRun[] };
const syncLabels: Record<string, string> = { running: "処理中", applied: "反映完了", unchanged: "反映済み・変更なし", review: "確認が必要・反映保留", error: "エラー・再試行待ち", waiting: "原本の保存待ち" };
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
  const thisMonth = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date());
  const [month, setMonth] = useState(thisMonth);
  const [available, setAvailable] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [reload, setReload] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [statusReload, setStatusReload] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function refreshStatus() {
      try {
        const response = await fetch("/api/schedule/status", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setSyncStatus(data); setStatusError("");
      } catch { if (!controller.signal.aborted) setStatusError("自動反映の状況を取得できません。接続を確認して再試行してください。"); }
    }
    void refreshStatus(); const timer = setInterval(() => void refreshStatus(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [statusReload]);
  useEffect(() => {
    const controller = new AbortController();
    async function discover() {
      setLoadingMonths(true); setError("");
      try {
        const response = await fetch("/api/schedule/preview", { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存済みのスケジュールを確認できませんでした。");
        const months = [...new Set<string>(data.months.map((f: { month: string }) => f.month))];
        setAvailable(months);
        if (months.length && !months.includes(thisMonth)) setMonth(months[0]);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "OneDriveに接続できませんでした。"); }
      finally { if (!controller.signal.aborted) setLoadingMonths(false); }
    }
    void discover();
    return () => { controller.abort(); active.current?.abort(); };
  }, [reload, thisMonth]);
  async function checkSchedule(apply = false) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 115000);
    setBusy(true); setReport(null); setError(""); setSyncMessage(""); setKind("all"); setCampus("all"); setShowLessons(false);
    try {
      if (apply) {
        const sync = await fetch(`/api/schedule/sync?month=${encodeURIComponent(month)}`, { method: "POST", signal: controller.signal, cache: "no-store" });
        const outcome = await sync.json();
        if (!sync.ok) throw new Error(outcome.error || "反映できませんでした。");
        if (active.current === controller) { setSyncMessage(outcome.message); setStatusReload((n) => n + 1); }
        // A separate comparison can be requested without extending the mutation request timeout.
        return;
      }
      const response = await fetch(`/api/schedule/preview?month=${encodeURIComponent(month)}`, { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "スケジュールを確認できませんでした。");
      if (active.current === controller) setReport(data as Report);
    } catch (e) { if (active.current === controller) setError(controller.signal.aborted ? "確認に時間がかかっています。もう一度お試しください。" : e instanceof Error ? e.message : "スケジュールを確認できませんでした。"); }
    finally { clearTimeout(timeout); if (active.current === controller) { setBusy(false); active.current = null; } }
  }
  return <main className="shell"><section className="panel">
    <p className="eyebrow">授業管理</p><h1>授業スケジュール取込</h1>
    <p>「【完成版】授業日誌システム」に「2026年9月スケジュール.xlsm」の形式でExcelを保存すると、今月・翌月の授業を自動で取り込みます。</p>
    <p>各月を約10分ごとに確認します。お急ぎの場合は「今すぐ取り込む」を押してください。時間・教室の変更後も欠席・遅刻の記録を引き継ぎます。</p>
    {statusError && <p role="alert">{statusError}</p>}
    {syncStatus && <section aria-label="自動反映の状況">
      <h2>自動反映の状況</h2>
      {(!syncStatus.enabled || syncStatus.stale) && <p role="alert">{!syncStatus.enabled ? "自動反映が停止しています。管理担当者による確認が必要です。" : "20分以上、処理の開始を確認できていません。「今すぐ取り込む」で再試行し、続く場合は管理担当者へお知らせください。"}</p>}
      {syncStatus.months.map((m) => { const last = syncStatus.runs.find((r) => r.month === m); return <p key={m}><strong>{m}：{last ? syncLabels[last.status] : "初回確認待ち"}</strong>{last && <><br />{new Date(last.finished_at || last.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）{last.message && <><br />{last.message}</>}</>}</p>; })}
      <details><summary>最近の処理履歴</summary><ul>{syncStatus.runs.map((r) => <li key={r.id}>{r.month} ／ {new Date(r.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} ／ {syncLabels[r.status]} {r.message}</li>)}</ul></details>
    </section>}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", margin: "24px 0" }}>
      <label style={{ display: "grid", gap: 8 }}>対象月
        <input aria-label="対象月" type="month" value={month} disabled={busy || loadingMonths} onChange={(e) => { setMonth(e.target.value); setReport(null); setError(""); setSyncMessage(""); }} style={{ fontSize: "1.1rem", padding: 10 }} /></label>
      <button type="button" disabled={busy || loadingMonths || !month} onClick={() => void checkSchedule()} style={{ padding: "12px 20px", fontWeight: 800 }}>{busy ? "Excelを読み取り・照合中…" : "スケジュールを確認"}</button>
      <button type="button" disabled={busy || loadingMonths || !syncStatus?.enabled || !syncStatus.months.includes(month)} onClick={() => void checkSchedule(true)} style={{ padding: "12px 20px", fontWeight: 800 }}>今すぐ取り込む</button>
      <button type="button" disabled={busy || loadingMonths} onClick={() => { setReport(null); setReload((n) => n + 1); }}>フォルダを再確認</button>
    </div>
    <p role="status" aria-live="polite">{busy ? "OneDriveの原本を取得して、登録済み授業と比較しています。そのままお待ちください。" : loadingMonths ? "OneDriveの保存済みスケジュールを確認しています…" : available.length ? `保存済みの月: ${available.join("、")}` : "原本が見つからない場合は、フォルダにExcelが保存されているか確認してください。"}</p>
    <p>「スケジュールを確認」は差分の表示、「今すぐ取り込む」は本番への反映です。休講・日付や校舎の移動・対応が曖昧な変更は、自動で確定せず、その月の反映を保留します。表示された差分を管理担当者へお知らせください。</p>
    {syncMessage && <p role="status">{syncMessage}</p>}
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
