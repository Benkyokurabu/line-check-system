"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Contact = {
  line_user_id: string;
  display_name: string | null;
  alias_name: string | null;
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/contacts");
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  function startEdit(c: Contact) {
    setEditingId(c.line_user_id);
    setEditValue(c.alias_name ?? c.display_name ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function saveAlias(userId: string) {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setSaving(userId);
    try {
      await fetch(`/api/admin/contacts/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias_name: trimmed }),
      });
      setContacts((prev) =>
        prev.map((c) =>
          c.line_user_id === userId ? { ...c, alias_name: trimmed } : c,
        ),
      );
      setEditingId(null);
    } finally {
      setSaving(null);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      // ヘッダー行をスキップ（line_user_id で始まる行）
      const dataLines = lines.filter((l) => !l.startsWith("line_user_id"));
      const rows: { line_user_id: string; alias_name: string }[] = [];
      for (const line of dataLines) {
        // CSV パース: "val1","val2","val3"
        const cols = line.match(/"([^"]*)"/g)?.map((s) => s.replace(/"/g, "")) ?? line.split(",");
        const lineUserId = cols[0]?.trim();
        const aliasName = cols[2]?.trim();
        if (lineUserId && aliasName) rows.push({ line_user_id: lineUserId, alias_name: aliasName });
      }
      if (rows.length === 0) {
        setImportMsg("登録名が入力された行がありませんでした。");
        return;
      }
      const res = await fetch("/api/admin/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      setImportMsg(`${data.imported} 件インポートしました。`);
      await fetchContacts();
    } catch {
      setImportMsg("エラーが発生しました。");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function clearAlias(userId: string) {
    setSaving(userId);
    try {
      await fetch(`/api/admin/contacts/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      setContacts((prev) =>
        prev.map((c) =>
          c.line_user_id === userId ? { ...c, alias_name: null } : c,
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.alias_name ?? "").toLowerCase().includes(q) ||
      (c.display_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="shell" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/dashboard" style={{ color: "var(--muted)", fontSize: "0.875rem", textDecoration: "none" }}>
            ← ダッシュボード
          </Link>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>連絡先管理</h1>
        </div>
        <button onClick={fetchContacts} style={btnRefresh} disabled={loading}>
          {loading ? "読込中…" : "更新"}
        </button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: 16 }}>
        LINE名の代わりに表示する「登録名」を設定できます。例: 山田太郎 父
      </p>

      {/* CSVインポート */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)" }}>
        <span style={{ fontSize: "0.875rem", color: "var(--muted)", flexShrink: 0 }}>CSVインポート:</span>
        <label style={{ ...btnEdit, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
          {importing ? "処理中…" : "CSVを選択"}
          <input type="file" accept=".csv" onChange={handleCsvImport} disabled={importing} style={{ display: "none" }} />
        </label>
        {importMsg && <span style={{ fontSize: "0.875rem", color: "var(--accent)" }}>{importMsg}</span>}
      </div>

      <input
        type="text"
        placeholder="名前で検索…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchInput}
      />

      <div className="panel" style={{ padding: 0, overflow: "hidden", marginTop: 12 }}>
        {loading ? (
          <p style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>読み込み中...</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>該当なし</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background)", borderBottom: "1px solid var(--line)" }}>
                <Th>LINE名</Th>
                <Th>登録名</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.line_user_id}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    opacity: saving === c.line_user_id ? 0.4 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  <td style={td}>
                    <span style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
                      {c.display_name ?? <span style={{ fontSize: "0.8rem" }}>未取得</span>}
                    </span>
                  </td>
                  <td style={td}>
                    {editingId === c.line_user_id ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveAlias(c.line_user_id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                        style={editInput}
                      />
                    ) : (
                      <span style={{ fontWeight: c.alias_name ? 600 : 400, color: c.alias_name ? "var(--foreground)" : "var(--muted)" }}>
                        {c.alias_name ?? "—"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {editingId === c.line_user_id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => saveAlias(c.line_user_id)}
                          disabled={saving === c.line_user_id || !editValue.trim()}
                          style={btnSave}
                        >
                          保存
                        </button>
                        <button onClick={cancelEdit} style={btnCancel}>
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => startEdit(c)}
                          disabled={saving === c.line_user_id}
                          style={btnEdit}
                        >
                          編集
                        </button>
                        {c.alias_name && (
                          <button
                            onClick={() => clearAlias(c.line_user_id)}
                            disabled={saving === c.line_user_id}
                            style={btnCancel}
                          >
                            削除
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 8 }}>
        {filtered.length} 件表示 / 全 {contacts.length} 件
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "11px 16px", textAlign: "left", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

const td: React.CSSProperties = { padding: "12px 16px", fontSize: "0.875rem", verticalAlign: "middle" };

const btnRefresh: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", cursor: "pointer", fontSize: "0.875rem",
};
const btnEdit: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 5, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", cursor: "pointer", fontSize: "0.8rem",
};
const btnSave: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 5, border: "none",
  background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
};
const btnCancel: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 5, border: "1px solid var(--line)",
  background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.8rem",
};
const searchInput: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", fontSize: "0.875rem", boxSizing: "border-box",
};
const editInput: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 5, border: "1px solid var(--accent)",
  background: "var(--surface)", color: "var(--foreground)", fontSize: "0.875rem", width: 220,
};
