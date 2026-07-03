"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  received_at: string | null;
  sent_by: string | null;
};

type Conversation = {
  line_user_id: string;
  display_name: string | null;
  teachers: string[];
  pending_route_ids: string[];
  messages: Message[];
  likely_resolved: boolean;
  latest_at: string | null;
};

type Contact = {
  line_user_id: string;
  display_name: string | null;
  alias_name: string | null;
};

export default function DashboardPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("全体");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [senderName, setSenderName] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);

  // 生徒検索して送信
  const [searchOpen, setSearchOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchSending, setSearchSending] = useState(false);
  const [searchSentMsg, setSearchSentMsg] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/conversations");
      const data = await res.json();
      const list: Conversation[] = data.conversations ?? [];
      setConversations(list);
      const allTeachers = [...new Set(list.flatMap((c) => c.teachers))].sort();
      setTeachers(allTeachers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const toggleSearch = useCallback(async () => {
    setSearchOpen((prev) => !prev);
    if (!contactsLoaded) {
      try {
        const res = await fetch("/api/admin/contacts");
        const data = await res.json();
        setContacts(data.contacts ?? []);
      } finally {
        setContactsLoaded(true);
      }
    }
  }, [contactsLoaded]);

  const searchResults =
    searchQuery.trim().length === 0
      ? []
      : contacts
          .filter((c) => {
            const q = searchQuery.trim().toLowerCase();
            return (
              (c.alias_name ?? "").toLowerCase().includes(q) ||
              (c.display_name ?? "").toLowerCase().includes(q)
            );
          })
          .slice(0, 8);

  async function sendToSelectedContact() {
    if (!selectedContact || !searchText.trim()) return;
    setSearchSending(true);
    setSearchSentMsg(null);
    try {
      const res = await fetch("/api/line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: selectedContact.line_user_id,
          text: searchText,
          sent_by: senderName.trim() || null,
        }),
      });
      if (res.ok) {
        setSearchText("");
        setSearchSentMsg("送信しました ✓");
      } else {
        setSearchSentMsg("送信に失敗しました");
      }
    } finally {
      setSearchSending(false);
    }
  }

  const displayed =
    activeTab === "全体"
      ? conversations
      : conversations.filter((c) => c.teachers.includes(activeTab));

  const countFor = (teacher: string) =>
    conversations.filter((c) => c.teachers.includes(teacher)).length;

  async function complete(conv: Conversation) {
    setCompleting(conv.line_user_id);
    try {
      await fetch(
        `/api/dashboard/conversations/${encodeURIComponent(conv.line_user_id)}/complete`,
        { method: "POST" },
      );
      setConversations((prev) => prev.filter((c) => c.line_user_id !== conv.line_user_id));
      if (expandedId === conv.line_user_id) setExpandedId(null);
    } finally {
      setCompleting(null);
    }
  }

  async function sendReply(conv: Conversation) {
    const text = replyTexts[conv.line_user_id]?.trim();
    if (!text) return;
    setSending(conv.line_user_id);
    try {
      const res = await fetch("/api/line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: conv.line_user_id,
          text,
          sent_by: senderName.trim() || null,
        }),
      });
      if (res.ok) {
        setReplyTexts((prev) => ({ ...prev, [conv.line_user_id]: "" }));
        const newMsg: Message = {
          id: `local_${Date.now()}`,
          direction: "outbound",
          text,
          received_at: new Date().toISOString(),
          sent_by: senderName.trim() || null,
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.line_user_id === conv.line_user_id
              ? { ...c, messages: [...c.messages, newMsg] }
              : c,
          ),
        );
      }
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>未対応メッセージ</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={toggleSearch} style={searchOpen ? btnGhostActive : btnGhost}>
            生徒を検索して送信
          </button>
          <Link href="/contacts" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            連絡先管理
          </Link>
          <button onClick={fetchConversations} style={btnGhost} disabled={loading}>
            {loading ? "読込中…" : "更新"}
          </button>
        </div>
      </div>

      {/* 生徒を検索して送信 */}
      {searchOpen && (
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="生徒名で検索…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedContact(null);
              setSearchSentMsg(null);
            }}
            autoFocus
            style={{ ...inputStyle, width: "100%" }}
          />

          {searchQuery.trim().length > 0 && !selectedContact && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {searchResults.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "8px 4px" }}>該当する生徒が見つかりません</p>
              ) : (
                searchResults.map((c) => (
                  <button
                    key={c.line_user_id}
                    onClick={() => { setSelectedContact(c); setSearchText(""); setSearchSentMsg(null); }}
                    style={contactResultBtn}
                  >
                    <span style={{ fontWeight: c.alias_name ? 600 : 400 }}>
                      {c.alias_name ?? c.display_name ?? "名前未設定"}
                    </span>
                    {c.alias_name && c.display_name && (
                      <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>({c.display_name})</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {selectedContact && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem" }}>
                  送信先: <strong>{selectedContact.alias_name ?? selectedContact.display_name ?? "名前未設定"}</strong>
                </span>
                <button onClick={() => { setSelectedContact(null); setSearchSentMsg(null); }} style={btnCancelSmall}>
                  変更
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendToSelectedContact(); }}
                  placeholder="メッセージを入力… (Ctrl+Enter で送信)"
                  rows={2}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 6,
                    border: "1px solid var(--line)", background: "var(--surface)",
                    color: "var(--foreground)", fontSize: "0.875rem",
                    resize: "vertical", fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={sendToSelectedContact}
                  disabled={searchSending || !searchText.trim()}
                  style={btnSend}
                >
                  {searchSending ? "送信中…" : "送信"}
                </button>
              </div>
              {searchSentMsg && (
                <p style={{ marginTop: 6, fontSize: "0.8rem", color: searchSentMsg.includes("失敗") ? "#dc2626" : "#16a34a" }}>
                  {searchSentMsg}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 送信者名（ページ上部で一度だけ設定） */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)", flexShrink: 0 }}>返信時の送信者名:</span>
        <input
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="例: 田中先生"
          style={inputStyle}
        />
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Tab label="全体" count={conversations.length} active={activeTab === "全体"} onClick={() => setActiveTab("全体")} />
        {teachers.map((t) => (
          <Tab key={t} label={t} count={countFor(t)} active={activeTab === t} onClick={() => setActiveTab(t)} />
        ))}
      </div>

      {/* 会話リスト */}
      {loading ? (
        <p style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>読み込み中...</p>
      ) : displayed.length === 0 ? (
        <p style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
          未対応のメッセージはありません ✓
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayed.map((conv) => (
            <ConversationCard
              key={conv.line_user_id}
              conv={conv}
              expanded={expandedId === conv.line_user_id}
              onToggle={() =>
                setExpandedId((prev) => (prev === conv.line_user_id ? null : conv.line_user_id))
              }
              onComplete={() => complete(conv)}
              completing={completing === conv.line_user_id}
              replyText={replyTexts[conv.line_user_id] ?? ""}
              onReplyChange={(t) => setReplyTexts((prev) => ({ ...prev, [conv.line_user_id]: t }))}
              onSend={() => sendReply(conv)}
              sending={sending === conv.line_user_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationCard({
  conv, expanded, onToggle, onComplete, completing,
  replyText, onReplyChange, onSend, sending,
}: {
  conv: Conversation;
  expanded: boolean;
  onToggle: () => void;
  onComplete: () => void;
  completing: boolean;
  replyText: string;
  onReplyChange: (t: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const lastInbound = [...conv.messages].reverse().find((m) => m.direction === "inbound");

  useEffect(() => {
    if (expanded && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [expanded, conv.messages.length]);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", opacity: completing ? 0.4 : 1, transition: "opacity 0.15s" }}>
      {/* ヘッダー */}
      <div
        onClick={onToggle}
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          background: expanded ? "var(--background)" : "transparent",
          borderBottom: expanded ? "1px solid var(--line)" : "none",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
              {conv.display_name ?? "名前未設定"}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--muted)", background: "var(--background)", padding: "1px 6px", borderRadius: 8 }}>
              {conv.messages.length}件
            </span>
            {conv.likely_resolved && (
              <span style={{ fontSize: "0.7rem", padding: "2px 7px", borderRadius: 10, background: "#dcfce7", color: "#16a34a", fontWeight: 600 }}>
                完了済みかも
              </span>
            )}
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
              担当: {conv.teachers.join(" / ")}
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lastInbound?.text ? truncate(lastInbound.text, 55) : "—"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {conv.latest_at && (
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
              {formatDate(conv.latest_at)}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            disabled={completing}
            style={btnDone}
          >
            完了
          </button>
        </div>
      </div>

      {/* 展開: メッセージスレッド + 返信 */}
      {expanded && (
        <>
          <div
            ref={threadRef}
            style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflowY: "auto" }}
          >
            {conv.messages.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.8rem", textAlign: "center" }}>
                直近30日のメッセージはありません
              </p>
            ) : (
              conv.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
            )}
          </div>

          {/* 返信欄 */}
          <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              value={replyText}
              onChange={(e) => onReplyChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend(); }}
              placeholder="返信を入力… (Ctrl+Enter で送信)"
              rows={2}
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 6,
                border: "1px solid var(--line)", background: "var(--surface)",
                color: "var(--foreground)", fontSize: "0.875rem",
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <button
              onClick={onSend}
              disabled={sending || !replyText.trim()}
              style={btnSend}
            >
              {sending ? "送信中…" : "送信"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 3 }}>
        {isOut ? (msg.sent_by ?? "学校") : "保護者"}
        {msg.received_at ? ` · ${formatTime(msg.received_at)}` : ""}
      </div>
      <div style={{
        maxWidth: "76%",
        padding: "8px 12px",
        borderRadius: isOut ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        background: isOut ? "var(--accent)" : "var(--surface)",
        color: isOut ? "#fff" : "var(--foreground)",
        fontSize: "0.875rem",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        border: isOut ? "none" : "1px solid var(--line)",
      }}>
        {msg.text ?? <span style={{ opacity: 0.6, fontStyle: "italic" }}>(テキストなし)</span>}
      </div>
    </div>
  );
}

function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)",
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : "var(--foreground)",
        cursor: "pointer", fontWeight: active ? 700 : 400, fontSize: "0.9rem",
        display: "flex", alignItems: "center", gap: 6,
      }}
    >
      {label}
      <span style={{ background: active ? "rgba(255,255,255,0.25)" : "var(--background)", borderRadius: 10, padding: "1px 7px", fontSize: "0.78rem", fontWeight: 700 }}>
        {count}
      </span>
    </button>
  );
}

const btnGhost: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", cursor: "pointer", fontSize: "0.875rem",
};
const btnGhostActive: React.CSSProperties = {
  ...btnGhost, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)",
};
const contactResultBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--line)", background: "var(--surface)", color: "var(--foreground)",
  cursor: "pointer", fontSize: "0.875rem", textAlign: "left",
};
const btnCancelSmall: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 5, border: "1px solid var(--line)",
  background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.75rem",
};
const btnDone: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 5, border: "none",
  background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
};
const btnSend: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6, border: "none",
  background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600,
  whiteSpace: "nowrap",
};
const inputStyle: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 5, border: "1px solid var(--line)",
  background: "var(--surface)", color: "var(--foreground)", fontSize: "0.875rem", width: 180,
};

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `今日 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨日 ${time}`;
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) + ` ${time}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
  );
}
