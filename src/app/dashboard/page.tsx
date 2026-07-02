"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Route = {
  id: string;
  teacher_name: string;
  confidence: number;
  route_type: string;
  reason: string | null;
  topic: string | null;
  handled_status: string;
  created_at: string;
  message_text: string | null;
  display_name: string | null;
  received_at: string | null;
};

export default function DashboardPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("全体");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/routes");
      const data = await res.json();
      const list: Route[] = data.routes ?? [];
      setRoutes(list);
      const unique = Array.from(new Set(list.map((r) => r.teacher_name)));
      setTeachers(unique);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  async function markAs(id: string, status: "done" | "dismissed") {
    setUpdating(id);
    try {
      await fetch(`/api/dashboard/routes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handled_status: status }),
      });
      setRoutes((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setUpdating(null);
    }
  }

  const displayed =
    activeTab === "全体"
      ? routes
      : routes.filter((r) => r.teacher_name === activeTab);

  const countFor = (teacher: string) =>
    routes.filter((r) => r.teacher_name === teacher).length;

  return (
    <div className="shell" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>未対応メッセージ</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/contacts" style={{ ...btnRefresh, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            連絡先管理
          </Link>
          <button onClick={fetchRoutes} style={btnRefresh} disabled={loading}>
            {loading ? "読込中…" : "更新"}
          </button>
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Tab
          label="全体"
          count={routes.length}
          active={activeTab === "全体"}
          onClick={() => setActiveTab("全体")}
        />
        {teachers.map((t) => (
          <Tab
            key={t}
            label={t}
            count={countFor(t)}
            active={activeTab === t}
            onClick={() => setActiveTab(t)}
          />
        ))}
      </div>

      {/* テーブル */}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <p style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>読み込み中...</p>
        ) : displayed.length === 0 ? (
          <p style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            未対応のメッセージはありません ✓
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background)", borderBottom: "1px solid var(--line)" }}>
                <Th>受信日時</Th>
                <Th>送信者</Th>
                <Th>メッセージ</Th>
                {activeTab === "全体" && <Th>担当先生</Th>}
                <Th>信頼度</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    opacity: updating === r.id ? 0.4 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  <td style={td}>{formatDate(r.received_at ?? r.created_at)}</td>
                  <td style={td}>{r.display_name ?? <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>名前未取得</span>}</td>
                  <td style={{ ...td, maxWidth: 320 }}>
                    <span title={r.message_text ?? ""}>{truncate(r.message_text ?? "—", 60)}</span>
                    {r.topic && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 2 }}>
                        話題: {r.topic}
                      </div>
                    )}
                  </td>
                  {activeTab === "全体" && <td style={td}>{r.teacher_name}</td>}
                  <td style={td}>
                    <span style={{ fontWeight: 600, color: confidenceColor(r.confidence) }}>
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => markAs(r.id, "done")}
                        disabled={updating === r.id}
                        style={btnDone}
                      >
                        対応済み
                      </button>
                      <button
                        onClick={() => markAs(r.id, "dismissed")}
                        disabled={updating === r.id}
                        style={btnDismiss}
                      >
                        対応不要
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : "var(--foreground)",
        cursor: "pointer",
        fontWeight: active ? 700 : 400,
        fontSize: "0.9rem",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {label}
      <span
        style={{
          background: active ? "rgba(255,255,255,0.25)" : "var(--background)",
          borderRadius: 10,
          padding: "1px 7px",
          fontSize: "0.78rem",
          fontWeight: 700,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "11px 16px",
        textAlign: "left",
        fontSize: "0.78rem",
        fontWeight: 700,
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

const td: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: "0.875rem",
  verticalAlign: "top",
};

const btnDone: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 5,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 600,
};

const btnDismiss: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 5,
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "0.8rem",
};

const btnRefresh: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: "0.875rem",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today) return `今日 ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `昨日 ${time}`;
  return (
    d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) +
    ` ${time}`
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function confidenceColor(c: number) {
  if (c >= 0.75) return "#16a34a";
  if (c >= 0.45) return "#d97706";
  return "var(--muted)";
}
