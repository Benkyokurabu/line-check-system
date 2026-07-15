"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { canonicalTeacherName } from "@/lib/teacher-names";
import { sendLineMessage } from "@/lib/send-line-message";

const CURRENT_TEACHER_KEY = "line-check:current-teacher";

type Student = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  gender: string | null;
  line_user_id: string | null;
  message_count: number;
  latest_at: string | null;
  line_accounts?: LineAccount[];
};

type LineAccount = {
  line_user_id: string;
  relation: string;
  alias_name: string | null;
  friend_display_name?: string | null;
  is_primary: boolean;
};

type Contact = {
  line_user_id: string;
  display_name: string | null;
  alias_name: string | null;
};

type ClassOption = {
  id: string;
  label: string;
  campus: string;
  grade: string;
  subject: string;
  class_name: string;
  count: number;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  message_type: string;
  received_at: string | null;
  created_at: string;
  sent_by: string | null;
};

type HistoryResponse = {
  student: Pick<Student, "student_number" | "grade" | "student_name" | "homeroom_teacher">;
  line_user_id: string | null;
  link_status: "linked" | "not_linked";
  messages: Message[];
};

export default function StudentsPage() {
  const [mode, setMode] = useState<"teacher" | "class">("teacher");
  const [currentTeacher, setCurrentTeacher] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return canonicalTeacherName(window.localStorage.getItem(CURRENT_TEACHER_KEY) ?? "");
  });
  const [teachers, setTeachers] = useState<string[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedCampus, setSelectedCampus] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [senderName, setSenderName] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      const [teacherRes, classRes] = await Promise.all([
        fetch("/api/admin/teachers"),
        fetch("/api/classes"),
      ]);
      const teacherData = await teacherRes.json();
      const classData = await classRes.json();
      if (cancelled) return;
      const names = (teacherData.teachers ?? []).map((t: { display_name: string }) => t.display_name);
      const classOptions = (classData.classes ?? []) as ClassOption[];
      setTeachers(names);
      setClasses(classOptions);
      setCurrentTeacher((prev) => prev || names[0] || "");
    }

    void loadOptions();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode === "teacher" && !currentTeacher) return;
    if (mode === "class" && !selectedClassId) return;

    let cancelled = false;

    async function loadStudents() {
      setLoading(true);
      const url = mode === "teacher"
        ? `/api/students?teacher=${encodeURIComponent(currentTeacher)}`
        : `/api/classes/${encodeURIComponent(selectedClassId)}/students`;
      const res = await fetch(url);
      const data = await res.json();
      if (cancelled) return;
      setStudents(data.students ?? []);
      setLoading(false);
    }

    if (mode === "teacher") {
      window.localStorage.setItem(CURRENT_TEACHER_KEY, currentTeacher);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedNumber(null);
    setHistory(null);
    setReplyText("");
    setSendMsg(null);
    void loadStudents();
    return () => { cancelled = true; };
  }, [mode, currentTeacher, selectedClassId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Student[]>();
    for (const student of students) {
      if (!map.has(student.grade)) map.set(student.grade, []);
      map.get(student.grade)!.push(student);
    }
    return [...map.entries()].sort(([a], [b]) => gradeOrder(a) - gradeOrder(b));
  }, [students]);

  const campusOptions = useMemo(
    () => [...new Set(classes.map((item) => item.campus))],
    [classes],
  );
  const gradeOptions = useMemo(
    () => [...new Set(classes.filter((item) => item.campus === selectedCampus).map((item) => item.grade))]
      .sort((a, b) => gradeOrder(a) - gradeOrder(b)),
    [classes, selectedCampus],
  );
  const subjectOptions = useMemo(
    () => [...new Set(classes
      .filter((item) => item.campus === selectedCampus && item.grade === selectedGrade)
      .map((item) => item.subject))],
    [classes, selectedCampus, selectedGrade],
  );
  const classOptions = useMemo(
    () => classes.filter((item) =>
      item.campus === selectedCampus &&
      item.grade === selectedGrade &&
      item.subject === selectedSubject),
    [classes, selectedCampus, selectedGrade, selectedSubject],
  );

  const currentTitle = mode === "teacher"
    ? `${currentTeacher || "先生未選択"} 担任生徒`
    : classes.find((item) => item.id === selectedClassId)?.label ?? "クラス未選択";

  async function openHistory(student: Student) {
    setSelectedNumber(student.student_number);
    setHistory(null);
    setReplyText("");
    setSendMsg(null);
    setContactSearch("");
    setSelectedContact(null);
    setHistoryLoading(true);
    try {
      const [res, loadedContacts] = await Promise.all([
        fetch(`/api/students/${encodeURIComponent(student.student_number)}/messages`),
        loadContacts(),
      ]);
      const data = await res.json();
      setHistory(data);
      setSelectedContact(
        loadedContacts.find((contact) => contact.line_user_id === data.line_user_id) ?? null,
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadContacts() {
    if (contactsLoaded) return contacts;
    const res = await fetch("/api/admin/contacts");
    const data = await res.json();
    const loaded = (data.contacts ?? []) as Contact[];
    setContacts(loaded);
    setContactsLoaded(true);
    return loaded;
  }

  async function ensureContactsLoaded() {
    await loadContacts();
  }

  async function refreshStudents() {
    const url = mode === "teacher"
      ? `/api/students?teacher=${encodeURIComponent(currentTeacher)}`
      : `/api/classes/${encodeURIComponent(selectedClassId)}/students`;
    const res = await fetch(url);
    const data = await res.json();
    setStudents(data.students ?? []);
  }

  async function linkContact(lineUserId: string) {
    if (!history?.student.student_number) return;
    setLinking(lineUserId);
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(history.student.student_number)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: lineUserId }),
      });
      if (!res.ok) {
        setSendMsg("送信先の登録に失敗しました");
        return;
      }
      const student = students.find((item) => item.student_number === history.student.student_number);
      if (student) await openHistory(student);
      await refreshStudents();
    } finally {
      setLinking(null);
    }
  }

  async function sendToSelectedStudent() {
    if (!history || !selectedContact || !replyText.trim()) return;
    setSending(true);
    setSendMsg(null);
    try {
      const res = await sendLineMessage({
        lineUserId: selectedContact.line_user_id,
        text: replyText,
        sentBy: senderName,
        context: "student_roster",
      });
      if (!res.ok) {
        setSendMsg("送信に失敗しました");
        return;
      }
      setReplyText("");
      setSendMsg("送信しました");
      const student = students.find((item) => item.student_number === history.student.student_number);
      if (student) await openHistory(student);
      await refreshStudents();
    } finally {
      setSending(false);
    }
  }

  const contactResults = contactSearch.trim()
    ? contacts
        .filter((contact) => {
          const q = contactSearch.trim().toLowerCase();
          return (
            (contact.alias_name ?? "").toLowerCase().includes(q) ||
            (contact.display_name ?? "").toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];

  return (
    <div className="shell" style={{ maxWidth: 1160 }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/dashboard" style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            ← ダッシュボード
          </Link>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 0 }}>生徒一覧</h1>
        </div>
      </div>

      <div className="panel" style={{ padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setMode("teacher")} style={mode === "teacher" ? btnActive : btnGhost}>担任で見る</button>
        <button onClick={() => setMode("class")} style={mode === "class" ? btnActive : btnGhost}>クラスで見る</button>
        {mode === "teacher" ? (
          <select value={currentTeacher} onChange={(e) => setCurrentTeacher(e.target.value)} style={inputStyle}>
            <option value="">先生を選択</option>
            {teachers.map((teacher) => <option key={teacher} value={teacher}>{teacher}</option>)}
          </select>
        ) : (
          <>
            <select value={selectedCampus} onChange={(e) => { setSelectedCampus(e.target.value); setSelectedGrade(""); setSelectedSubject(""); setSelectedClassId(""); }} style={inputStyle}>
              <option value="">校舎を選択</option>
              {campusOptions.map((campus) => <option key={campus} value={campus}>{campus}</option>)}
            </select>
            <select value={selectedGrade} disabled={!selectedCampus} onChange={(e) => { setSelectedGrade(e.target.value); setSelectedSubject(""); setSelectedClassId(""); }} style={inputStyle}>
              <option value="">学年を選択</option>
              {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
            </select>
            <select value={selectedSubject} disabled={!selectedGrade} onChange={(e) => { setSelectedSubject(e.target.value); setSelectedClassId(""); }} style={inputStyle}>
              <option value="">科目を選択</option>
              {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
            </select>
            <select value={selectedClassId} disabled={!selectedSubject} onChange={(e) => setSelectedClassId(e.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
              <option value="">クラスを選択</option>
              {classOptions.map((classOption) => (
                <option key={classOption.id} value={classOption.id}>{classOption.class_name}（{classOption.count}名）</option>
              ))}
            </select>
          </>
        )}
        <input
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="送信者名 例: 田中先生"
          style={{ ...inputStyle, width: 210 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {loading ? (
            <div className="panel" style={{ padding: 24, color: "var(--muted)" }}>読み込み中...</div>
          ) : grouped.length === 0 ? (
            <div className="panel" style={{ padding: 24, color: "var(--muted)" }}>該当する生徒がいません。</div>
          ) : (
            grouped.map(([grade, gradeStudents]) => (
              <section key={grade} className="panel" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--background)" }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>{currentTitle} / {grade}</h2>
                  <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{gradeStudents.length}名</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <Th>学籍番号</Th>
                      <Th>名前</Th>
                      <Th>担任</Th>
                      <Th>LINE</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeStudents.map((student) => (
                      <tr
                        key={student.student_number}
                        onClick={() => openHistory(student)}
                        style={{
                          borderBottom: "1px solid var(--line)",
                          cursor: "pointer",
                          background: selectedNumber === student.student_number ? "#ecfdf3" : "transparent",
                        }}
                      >
                        <td style={tdMono}>{student.student_number}</td>
                        <td style={tdStrong}>{student.student_name}</td>
                        <td style={td}>{student.homeroom_teacher}</td>
                        <td style={td}>
                          {mode === "class" ? (
                            <LineAccountList student={student} />
                          ) : student.line_user_id ? `${student.message_count}件` : "未紐づけ"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </div>

        <aside className="panel" style={{ padding: 0, overflow: "hidden", position: "sticky", top: 20 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", background: "var(--background)" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>LINE履歴・送信</h2>
          </div>
          {historyLoading ? (
            <p style={{ padding: 20, color: "var(--muted)" }}>読み込み中...</p>
          ) : !history ? (
            <p style={{ padding: 20, color: "var(--muted)" }}>左の一覧から生徒を選択してください。</p>
          ) : history.link_status !== "linked" ? (
            <div style={{ padding: 20 }}>
              <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>{history.student.student_name}</h3>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
                この生徒はまだLINE連絡先と紐づいていません。保護者名やLINE表示名で検索して紐づけてください。
              </p>
              <input
                value={contactSearch}
                onFocus={ensureContactsLoaded}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  void ensureContactsLoaded();
                }}
                placeholder="LINE名・登録名で検索"
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
              />
              {contactSearch.trim() && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {contactResults.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.82rem" }}>該当する連絡先がありません。</p>
                  ) : (
                    contactResults.map((contact) => (
                      <button
                        key={contact.line_user_id}
                        onClick={() => linkContact(contact.line_user_id)}
                        disabled={linking === contact.line_user_id}
                        style={contactButton}
                      >
                        <span style={{ fontWeight: 700 }}>{contact.alias_name ?? contact.display_name ?? "名前未設定"}</span>
                        {contact.alias_name && contact.display_name && (
                          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>({contact.display_name})</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>{history.student.student_name}</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                  {history.student.grade} / {history.student.student_number} / {history.messages.length}件
                </p>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, maxHeight: "48vh", overflowY: "auto" }}>
                {history.messages.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>履歴はありません。</p>
                ) : (
                  history.messages.map((message) => <MessageBubble key={message.id} message={message} />)
                )}
              </div>
              <div style={{ borderTop: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedContact ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: "0.82rem" }}>
                      送信先: <strong>{selectedContact.alias_name ?? selectedContact.display_name ?? "名前未設定"}</strong>
                      {selectedContact.alias_name && selectedContact.display_name && (
                        <span style={{ color: "var(--muted)" }}> ({selectedContact.display_name})</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedContact(null);
                        setContactSearch(history.student.student_name);
                        void ensureContactsLoaded();
                      }}
                      style={btnGhost}
                    >
                      変更
                    </button>
                  </div>
                ) : (
                  <div style={{ padding: 10, border: "1px solid #f59e0b", borderRadius: 8, background: "#fffbeb" }}>
                    <p style={{ color: "#92400e", fontSize: "0.82rem", marginBottom: 8 }}>
                      送信先を確認してください。選択した連絡先をこの生徒の送信先として登録します。
                    </p>
                    <input
                      value={contactSearch}
                      onFocus={ensureContactsLoaded}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        void ensureContactsLoaded();
                      }}
                      placeholder="LINE名・登録名で検索"
                      style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {contactResults.map((contact) => (
                        <button
                          key={contact.line_user_id}
                          type="button"
                          onClick={() => linkContact(contact.line_user_id)}
                          disabled={linking === contact.line_user_id}
                          style={contactButton}
                        >
                          <span style={{ fontWeight: 700 }}>{contact.alias_name ?? contact.display_name ?? "名前未設定"}</span>
                          {contact.alias_name && contact.display_name && (
                            <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>({contact.display_name})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="選択した生徒へ送信するメッセージ"
                  rows={3}
                  style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                />
                <button onClick={sendToSelectedStudent} disabled={sending || !selectedContact || !replyText.trim()} style={btnSend}>
                  {sending ? "送信中..." : "この生徒に送信"}
                </button>
                {sendMsg && <p style={{ color: sendMsg.includes("失敗") ? "#dc2626" : "#16a34a", fontSize: "0.82rem" }}>{sendMsg}</p>}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "0.78rem", color: "var(--muted)", fontWeight: 700 }}>{children}</th>;
}

function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === "outbound";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: outbound ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 3 }}>
        {outbound ? (message.sent_by ?? "学校") : "保護者"} · {formatDate(message.received_at ?? message.created_at)}
      </div>
      <div style={{
        maxWidth: "86%",
        padding: "8px 11px",
        borderRadius: outbound ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        background: outbound ? "var(--accent)" : "var(--surface)",
        color: outbound ? "#fff" : "var(--foreground)",
        border: outbound ? "none" : "1px solid var(--line)",
        fontSize: "0.84rem",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {message.text ?? `(${message.message_type})`}
      </div>
    </div>
  );
}

function LineAccountList({ student }: { student: Student }) {
  const seen = new Set<string>();
  const accounts = (student.line_accounts ?? []).filter((account) => {
    const key = account.alias_name ?? account.friend_display_name ?? account.line_user_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (accounts.length === 0) return <span style={{ color: "var(--muted)" }}>未紐づけ</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {accounts.map((account) => (
        <span key={account.line_user_id} style={{ fontSize: "0.76rem" }}>
          <strong>{relationLabel(account.relation)}</strong> {account.alias_name ?? account.friend_display_name ?? "名前未設定"}
          {account.line_user_id === student.line_user_id && <span style={{ color: "#16a34a" }}> ・送信先</span>}
        </span>
      ))}
    </div>
  );
}

function relationLabel(relation: string) {
  return relation === "mother" ? "母" :
    relation === "father" ? "父" :
    relation === "guardian" ? "保護者" :
    relation === "family" ? "家族" :
    relation === "student" ? "本人" : "関係未設定";
}

function gradeOrder(grade: string) {
  const normalized = grade.normalize("NFKC");
  const prefix = normalized.startsWith("小") ? 0 : 10;
  const number = Number(normalized.replace(/[^0-9]/g, ""));
  return prefix + number;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: "0.875rem",
};

const btnActive: React.CSSProperties = {
  ...btnGhost,
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
};

const btnSend: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 700,
};

const contactButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: "0.84rem",
  textAlign: "left",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--foreground)",
  fontSize: "0.875rem",
};

const td: React.CSSProperties = {
  padding: "11px 14px",
  fontSize: "0.86rem",
  color: "var(--muted)",
};

const tdStrong: React.CSSProperties = {
  ...td,
  color: "var(--foreground)",
  fontWeight: 700,
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "Consolas, monospace",
  color: "var(--foreground)",
};
