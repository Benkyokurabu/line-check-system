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

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function valueByHeaders(record: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function rowsFromCsv(text: string) {
  const parsed = parseCsv(text);
  const headers = parsed.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.includes("line_user_id")) throw new Error("line_user_id 列があるCSVを選択してください");

  return parsed.map((values, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const lineUserId = valueByHeaders(record, ["line_user_id"]);
    const aliasName = valueByHeaders(record, ["alias_name", "登録名", "registered_name"]);
    const displayName = valueByHeaders(record, ["display_name", "stored_display_name", "profile_display_name", "LINE名"]);
    const groupName = valueByHeaders(record, ["group_name", "グループ", "group"]);
    const sourceStatus = valueByHeaders(record, ["status", "source", "match_method"]);
    return {
      id: `${lineUserId || "row"}-${index}`,
      enabled: Boolean(lineUserId && aliasName),
      line_user_id: lineUserId,
      display_name: displayName,
      alias_name: aliasName,
      group_name: groupName,
      source_status: sourceStatus,
      note: !lineUserId ? "LINE IDなし" : !aliasName ? "登録名なし" : "",
    } satisfies ImportRow;
  });
}

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
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const duplicateLineIds = useMemo(() => duplicateIds(rows), [rows]);
  const enabledRows = rows.filter((row) => row.enabled && row.line_user_id.trim() && row.alias_name.trim());

  function loadText(text: string) {
    try {
      const nextRows = rowsFromCsv(text);
      setRows(nextRows);
      setMessage(`${nextRows.length}件を読み込みました。内容を確認して、必要なら編集してください。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    loadText(text);
    event.target.value = "";
  }

  function updateRow(id: string, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function removeDisabled() {
    setRows((current) => current.filter((row) => row.enabled));
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
        <label style={{ ...buttonStyle, display: "inline-flex" }}>
          CSVを選択
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} style={{ display: "none" }} />
        </label>
        <button type="button" style={ghostButtonStyle} onClick={() => loadText(pasteText)} disabled={!pasteText.trim()}>貼り付けCSVを読み込み</button>
        <button type="button" style={ghostButtonStyle} onClick={removeDisabled} disabled={rows.length === 0}>チェックなし行を非表示</button>
      </div>
      <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="CSVの中身を貼り付けても読み込めます" style={{ ...inputStyle, minHeight: 88, resize: "vertical", fontFamily: "Consolas, monospace" }} />
      <p>LINE管理画面から出したCSV、または取り込みレポートCSVを読み込み、登録名を確認してから確定します。</p>
      {message && <p role="status" style={{ color: message.includes("失敗") || message.includes("なし") ? "#b42318" : "var(--muted)", fontWeight: 700 }}>{message}</p>}
    </section>

    <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong>取り込み候補 {enabledRows.length}件 / 読み込み {rows.length}件</strong>
        <button type="button" style={buttonStyle} onClick={confirmImport} disabled={saving || enabledRows.length === 0}>{saving ? "登録中..." : "全部OKなので登録を確定"}</button>
      </div>
      {rows.length === 0 ? <p style={{ padding: 24 }}>CSVを読み込むと、ここに登録候補が表示されます。</p> : <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr style={{ background: "var(--background)", borderBottom: "1px solid var(--line)" }}>
              <Th>対象</Th>
              <Th>LINE ID</Th>
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
                <td style={{ ...td, fontFamily: "Consolas, monospace", fontSize: 12 }}>{row.line_user_id || "-"}</td>
                <td style={td}><input value={row.display_name} onChange={(event) => updateRow(row.id, { display_name: event.target.value })} style={inputStyle} placeholder="LINE名" /></td>
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
