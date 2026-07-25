"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type ImportRow = {
  id: string;
  enabled: boolean;
  line_user_id: string;
  display_name: string;
  alias_name: string;
  group_name: string;
  source_status: string;
  note: string;
};

type ImportPreview = {
  ok: boolean;
  file: string;
  rows: ImportRow[];
  enabled_count: number;
  message: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.875rem",
};

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: "9px 13px",
  background: "var(--accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 12px",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontWeight: 700,
  cursor: "pointer",
};

function duplicateIds(rows: ImportRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.line_user_id) continue;
    counts.set(row.line_user_id, (counts.get(row.line_user_id) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

export default function LineAliasImportPage() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const duplicateLineIds = useMemo(() => duplicateIds(rows), [rows]);
  const enabledRows = rows.filter((row) => row.enabled && row.line_user_id.trim() && row.alias_name.trim());

  async function loadImportCandidates() {
    setLoading(true);
    setMessage("取り込み候補を確認しています...");
    try {
      const response = await fetch("/api/admin/contacts/import");
      const body = await response.json() as ImportPreview | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error ?? "読み込みに失敗しました" : "読み込みに失敗しました");
      const preview = body as ImportPreview;
      setRows(preview.rows ?? []);
      setSelectedFile(preview.file ?? "");
      setMessage(preview.message ?? `${preview.rows?.length ?? 0}件を読み込みました。内容を確認して、問題なければ確定してください。`);
    } catch (error) {
      setRows([]);
      setSelectedFile("");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function updateRow(id: string, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function confirmImport() {
    if (enabledRows.length === 0) { setMessage("確定できる行がありません。"); return; }
    if (!window.confirm(`${enabledRows.length}件のLINE登録名をアプリへ反映します。よろしいですか？`)) return;
    setSaving(true);
    setMessage("登録しています...");
    try {
      const response = await fetch("/api/admin/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: enabledRows.map((row) => ({
            line_user_id: row.line_user_id.trim(),
            alias_name: row.alias_name.trim(),
            group_name: row.group_name.trim(),
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "登録に失敗しました");
      setMessage(`${body.imported ?? enabledRows.length}件を登録しました。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return <main className="shell" style={{ maxWidth: 1180 }}>
    <div style={{ marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <p className="eyebrow">LINE contact import</p>
        <h1 style={{ fontSize: "2rem" }}>LINE登録名の取り込み</h1>
      </div>
      <Link href="/contacts" style={ghostButtonStyle}>連絡先管理へ</Link>
    </div>

    <section className="panel" style={{ padding: 16, display: "grid", gap: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={loadImportCandidates} disabled={loading || saving}>{loading ? "確認中..." : "取り込み"}</button>
        <button type="button" style={buttonStyle} onClick={confirmImport} disabled={loading || saving || enabledRows.length === 0}>{saving ? "確定中..." : "確定"}</button>
        <strong style={{ marginLeft: 4 }}>取り込み候補 {enabledRows.length}件 / 読み込み {rows.length}件</strong>
      </div>
      {selectedFile && <p style={{ margin: 0, color: "var(--muted)", fontWeight: 700 }}>対象ファイル: {selectedFile}</p>}
      {message && <p role="status" style={{ color: message.includes("失敗") || message.includes("なし") || message.includes("見つかりません") ? "#b42318" : "var(--muted)", fontWeight: 700 }}>{message}</p>}
    </section>

    <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
      {rows.length === 0 ? <p style={{ padding: 24 }}>取り込みを押すと、候補ファイルを自動で読み込んでここに表示します。</p> : <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
          <thead>
            <tr style={{ background: "var(--background)", borderBottom: "1px solid var(--line)" }}>
              <Th>登録</Th>
              <Th>LINE名</Th>
              <Th>登録名</Th>
              <Th>グループ</Th>
              <Th>状態</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const duplicated = duplicateLineIds.has(row.line_user_id);
              const invalid = !row.line_user_id || !row.alias_name;
              return <tr key={row.id} style={{ borderBottom: "1px solid var(--line)", background: row.enabled ? "white" : "#f7f7f4" }}>
                <td style={td}><input type="checkbox" checked={row.enabled} onChange={(event) => updateRow(row.id, { enabled: event.target.checked })} /></td>
                <td style={td}>
                  <strong>{row.display_name || "LINE名なし"}</strong>
                  <div style={{ color: "var(--muted)", fontFamily: "Consolas, monospace", fontSize: 11, marginTop: 3 }}>{row.line_user_id || "LINE IDなし"}</div>
                </td>
                <td style={td}><input value={row.alias_name} onChange={(event) => updateRow(row.id, { alias_name: event.target.value, enabled: Boolean(row.line_user_id && event.target.value.trim()) })} style={inputStyle} placeholder="例: 本 山田太郎 母" /></td>
                <td style={td}><input value={row.group_name} onChange={(event) => updateRow(row.id, { group_name: event.target.value })} style={inputStyle} placeholder="例: 中3本科" /></td>
                <td style={td}><span style={{ color: invalid || duplicated ? "#b42318" : "var(--muted)", fontWeight: 700 }}>{invalid ? row.note : duplicated ? "重複ID" : row.source_status || "OK"}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </section>
  </main>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</th>;
}

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
  fontSize: "0.85rem",
};
