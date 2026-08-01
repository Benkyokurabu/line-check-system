"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type CandidateKind = "add" | "update" | "class_update" | "notion_only" | "excel_only" | "app_only";

type Candidate = {
  student_number: string;
  kind: CandidateKind;
  severity: "apply" | "review" | "info";
  selected_by_default: boolean;
  can_apply: boolean;
  notion: { student_name?: string | null } | null;
  excel: StudentSnapshot | null;
  app: StudentSnapshot | null;
  changes: string[];
};

type StudentSnapshot = {
  student_name?: string | null;
  grade?: string | null;
  campus?: string | null;
  homeroom_teacher?: string | null;
  school_name?: string | null;
  source_file?: string | null;
  classes?: string[];
};

type Preview = {
  generated_at: string;
  target: { student_number_min_exclusive: number };
  notion: { data_source_id: string; students: number; skipped: number };
  excel: { files: Array<{ file: string; size: number; mtime: string }>; students: number; class_enrollments: number };
  app: { students: number; class_enrollments: number };
  counts: Record<CandidateKind, number>;
  candidates: Candidate[];
};

type SyncResult = {
  synced_students: number;
  synced_class_enrollments: number;
  skipped: number;
};

const kindLabels: Record<CandidateKind, string> = {
  add: "追加",
  update: "基本情報更新",
  class_update: "クラス更新",
  notion_only: "Notionのみ",
  excel_only: "Excelのみ",
  app_only: "アプリのみ",
};

export default function NotionRosterPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CandidateKind | "all">("all");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const visibleCandidates = useMemo(() => {
    const rows = preview?.candidates ?? [];
    return filter === "all" ? rows : rows.filter((candidate) => candidate.kind === filter);
  }, [filter, preview]);

  async function loadPreview() {
    setLoading(true);
    setMessage("Notionとクラス一覧Excelを照合しています...");
    setPreview(null);
    setSelected(new Set());
    try {
      const response = await fetch("/api/admin/notion-roster/preview", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "照合に失敗しました");
      const nextPreview = body as Preview;
      setPreview(nextPreview);
      setSelected(new Set(nextPreview.candidates.filter((candidate) => candidate.can_apply && candidate.selected_by_default).map((candidate) => candidate.student_number)));
      setMessage(`照合しました。差分 ${nextPreview.candidates.length}件です。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function toggle(studentNumber: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentNumber)) next.delete(studentNumber);
      else next.add(studentNumber);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const candidate of visibleCandidates) {
        if (candidate.can_apply) next.add(candidate.student_number);
      }
      return next;
    });
  }

  function clearVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const candidate of visibleCandidates) next.delete(candidate.student_number);
      return next;
    });
  }

  async function syncSelected() {
    const studentNumbers = [...selected];
    if (studentNumbers.length === 0) {
      setMessage("反映する生徒を選択してください。");
      return;
    }
    if (!window.confirm(`選択した ${studentNumbers.length}名をアプリ側名簿へ反映します。\nLINE紐づけは変更しません。\n実行しますか？`)) return;

    setSyncing(true);
    setMessage("選択した差分を反映しています...");
    try {
      const response = await fetch("/api/admin/notion-roster/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_numbers: studentNumbers }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "反映に失敗しました");
      const result = body as SyncResult;
      setMessage(`同期完了: 生徒 ${result.synced_students}名、クラス所属 ${result.synced_class_enrollments}件を反映しました。スキップ ${result.skipped}件。`);
      await loadPreview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="shell" style={{ maxWidth: 1180 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <Link href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: "0.875rem" }}>← ホーム</Link>
          <h1 style={{ fontSize: "1.55rem" }}>Notion・クラス一覧 照合</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={loadPreview} disabled={loading || syncing} style={buttonStyle}>{loading ? "照合中..." : "Notion + Excelを照合"}</button>
          <button type="button" onClick={syncSelected} disabled={syncing || loading || selected.size === 0} style={primaryButtonStyle}>{syncing ? "反映中..." : `選択した差分を反映 (${selected.size})`}</button>
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {preview && (
        <>
          <section className="panel" style={{ padding: 16, display: "grid", gap: 14, marginBottom: 16 }}>
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "#f7f7f4", fontWeight: 800 }}>
              現在の照合対象: 学籍番号 {preview.target.student_number_min_exclusive} より大きい生徒
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
              <Metric label="Notion生徒情報" value={`${preview.notion.students}名`} detail={preview.notion.skipped ? `未読取 ${preview.notion.skipped}件` : "読取OK"} />
              <Metric label="クラス一覧Excel" value={`${preview.excel.students}名`} detail={`${preview.excel.class_enrollments}件のクラス所属`} />
              <Metric label="アプリ側名簿" value={`${preview.app.students}名`} detail={`${preview.app.class_enrollments}件のクラス所属`} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>全て {preview.candidates.length}</FilterButton>
              {Object.entries(kindLabels).map(([kind, label]) => (
                <FilterButton key={kind} active={filter === kind} onClick={() => setFilter(kind as CandidateKind)}>{label} {preview.counts[kind as CandidateKind]}</FilterButton>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={selectVisible}>表示中を選択</button>
              <button type="button" style={buttonStyle} onClick={clearVisible}>表示中を解除</button>
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.82rem", display: "grid", gap: 3 }}>
              {preview.excel.files.map((file) => <span key={file.file}>・{file.file}</span>)}
            </div>
          </section>

          <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
            {visibleCandidates.length === 0 ? (
              <p style={{ padding: 24, color: "var(--muted)" }}>表示する差分はありません。</p>
            ) : (
              <div style={{ display: "grid" }}>
                {visibleCandidates.map((candidate) => (
                  <article key={candidate.student_number} style={{ borderBottom: "1px solid var(--line)", padding: 14, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                        <input type="checkbox" checked={selected.has(candidate.student_number)} disabled={!candidate.can_apply} onChange={() => toggle(candidate.student_number)} />
                        <span style={{ display: "grid", gap: 3 }}>
                          <strong>{candidate.student_number} {candidate.notion?.student_name ?? candidate.excel?.student_name ?? candidate.app?.student_name ?? "氏名不明"}</strong>
                          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{candidate.changes.join(" / ")}</span>
                        </span>
                      </label>
                      <span style={{ ...badgeStyle, background: candidate.can_apply ? "#f2fbf5" : "#fff7ed", color: candidate.can_apply ? "#087a3d" : "#9a3412" }}>{kindLabels[candidate.kind]}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
                      <Snapshot title="Notion" value={candidate.notion ? { student_name: candidate.notion.student_name } : null} />
                      <Snapshot title="Excel" value={candidate.excel} />
                      <Snapshot title="アプリ側" value={candidate.app} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "var(--surface)", display: "grid", gap: 4 }}>
    <span style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 800 }}>{label}</span>
    <strong style={{ fontSize: "1.25rem" }}>{value}</strong>
    <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{detail}</span>
  </div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} style={active ? primaryButtonStyle : buttonStyle}>{children}</button>;
}

function Snapshot({ title, value }: { title: string; value: StudentSnapshot | null }) {
  if (!value) return <div style={snapshotStyle}><strong>{title}</strong><span style={{ color: "var(--muted)" }}>なし</span></div>;
  return <div style={snapshotStyle}>
    <strong>{title}</strong>
    <span>{value.student_name ?? "氏名なし"}</span>
    <span>{[value.grade, value.campus, value.homeroom_teacher && `担任 ${value.homeroom_teacher}`].filter(Boolean).join(" / ") || "基本情報なし"}</span>
    {value.school_name && <span>{value.school_name}</span>}
    {value.classes && value.classes.length > 0 && <span style={{ color: "var(--muted)" }}>{value.classes.slice(0, 6).join(" / ")}{value.classes.length > 6 ? " ..." : ""}</span>}
  </div>;
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 12px",
  background: "var(--surface)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: "0.85rem",
  fontWeight: 700,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: 0,
  background: "var(--accent)",
  color: "white",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: 12,
  background: "var(--surface)",
  marginBottom: 16,
  fontWeight: 700,
};

const badgeStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: "0.76rem",
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const snapshotStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: 10,
  background: "var(--surface)",
  display: "grid",
  gap: 4,
  fontSize: "0.82rem",
  minWidth: 0,
};
