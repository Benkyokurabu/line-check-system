"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Contact = {
  line_user_id: string;
  display_name: string | null;
  alias_name: string | null;
  group_name: string | null;
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("全て");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupValue, setEditGroupValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [rosterImportMsg, setRosterImportMsg] = useState<string | null>(null);

  // グループへ一斉送信
  const [broadcastGroup, setBroadcastGroup] = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastSenderName, setBroadcastSenderName] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);

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

  function handleRosterImportClick() {
    setRosterImportMsg(
      "クラス一覧表の取り込み処理は次の段階で接続します。ボタンの配置だけ完了しています。",
    );
  }

  function startEditGroup(c: Contact) {
    setEditingGroupId(c.line_user_id);
    setEditGroupValue(c.group_name ?? "");
  }

  function cancelEditGroup() {
    setEditingGroupId(null);
    setEditGroupValue("");
  }

  async function saveGroup(userId: string) {
    const trimmed = editGroupValue.trim();
    setSaving(userId);
    try {
      await fetch(`/api/admin/contacts/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_name: trimmed }),
      });
      setContacts((prev) =>
        prev.map((c) =>
          c.line_user_id === userId ? { ...c, group_name: trimmed || null } : c,
        ),
      );
      setEditingGroupId(null);
    } finally {
      setSaving(null);
    }
  }

  const groups = [...new Set(contacts.map((c) => c.group_name).filter((g): g is string => !!g))].sort(
    (a, b) => a.localeCompare(b, "ja"),
  );

  async function sendBroadcast() {
    if (!broadcastGroup || !broadcastText.trim()) return;
    setBroadcasting(true);
    setBroadcastMsg(null);
    try {
      const res = await fetch("/api/line/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: broadcastGroup,
          text: broadcastText,
          sent_by: broadcastSenderName.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBroadcastText("");
        setBroadcastMsg(`${data.sent} 件に送信しました ✓`);
      } else {
        setBroadcastMsg(data.error ?? "送信に失敗しました");
      }
    } finally {
      setBroadcasting(false);
    }
  }

  const filtered = contacts.filter((c) => {
    if (groupFilter !== "全て" && c.group_name !== groupFilter) return false;
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)" }}>
        <span style={{ fontSize: "0.875rem", color: "var(--muted)", flexShrink: 0 }}>クラス一覧表:</span>
        <button onClick={handleRosterImportClick} style={btnEdit}>
          クラス一覧表を再取り込み
        </button>
        {rosterImportMsg && <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{rosterImportMsg}</span>}
      </div>

      {/* グループへ一斉送信 */}
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 10 }}>グループへ一斉送信</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select
            value={broadcastGroup}
            onChange={(e) => { setBroadcastGroup(e.target.value); setBroadcastMsg(null); }}
            style={{ ...inputStyle, width: 180 }}
          >
            <option value="">グループを選択…</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="送信者名（任意）例: 田中先生"
            value={broadcastSenderName}
            onChange={(e) => setBroadcastSenderName(e.target.value)}
            style={{ ...inputStyle, width: 200 }}
          />
        </div>
        {groups.length === 0 && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 8 }}>
            まだグループが登録されていません。下の一覧で各生徒に「グループ」を設定してください。
          </p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="一斉送信するメッセージを入力…"
            rows={2}
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 6,
              border: "1px solid var(--line)", background: "var(--surface)",
              color: "var(--foreground)", fontSize: "0.875rem",
              resize: "vertical", fontFamily: "inherit",
            }}
          />
          <button
            onClick={sendBroadcast}
            disabled={broadcasting || !broadcastGroup || !broadcastText.trim()}
            style={btnSave}
          >
            {broadcasting ? "送信中…" : "一斉送信"}
          </button>
        </div>
        {broadcastMsg && (
          <p style={{ marginTop: 6, fontSize: "0.8rem", color: broadcastMsg.includes("失敗") ? "#dc2626" : "#16a34a" }}>
            {broadcastMsg}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="名前で検索…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...searchInput, flex: 1 }}
        />
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="全て">グループ: 全て</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

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
                <Th>グループ</Th>
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
                  <td style={td}>
                    {editingGroupId === c.line_user_id ? (
                      <input
                        type="text"
                        value={editGroupValue}
                        onChange={(e) => setEditGroupValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveGroup(c.line_user_id);
                          if (e.key === "Escape") cancelEditGroup();
                        }}
                        placeholder="例: 高3理系"
                        autoFocus
                        style={editInput}
                      />
                    ) : (
                      <span style={{ fontWeight: c.group_name ? 600 : 400, color: c.group_name ? "var(--foreground)" : "var(--muted)" }}>
                        {c.group_name ?? "—"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                      {editingId === c.line_user_id ? (
                        <>
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
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(c)}
                            disabled={saving === c.line_user_id}
                            style={btnEdit}
                          >
                            登録名編集
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
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {editingGroupId === c.line_user_id ? (
                        <>
                          <button
                            onClick={() => saveGroup(c.line_user_id)}
                            disabled={saving === c.line_user_id}
                            style={btnSave}
                          >
                            保存
                          </button>
                          <button onClick={cancelEditGroup} style={btnCancel}>
                            キャンセル
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEditGroup(c)}
                          disabled={saving === c.line_user_id}
                          style={btnEdit}
                        >
                          グループ編集
                        </button>
                      )}
                    </div>
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
const inputStyle: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 6, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", fontSize: "0.875rem",
};
const editInput: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 5, border: "1px solid var(--accent)",
  background: "var(--surface)", color: "var(--foreground)", fontSize: "0.875rem", width: 220,
};
