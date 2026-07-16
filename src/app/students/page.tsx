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
  selected_account?: LineAccount | null;
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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [registrationRelation, setRegistrationRelation] = useState("guardian");
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
    setSelectedAccountId(null);
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

  async function openHistory(student: Student, account: LineAccount | null = studentAccount(student)) {
    const accountId = account?.line_user_id ?? null;
    setRegistrationRelation(account?.relation ?? "student");
    setSelectedNumber(student.student_number);
    setSelectedAccountId(accountId);
    setHistory(null);
    setReplyText("");
    setSendMsg(null);
    setContactSearch("");
    setSelectedContact(null);
    setHistoryLoading(true);
    try {
      const query = `?line_user_id=${encodeURIComponent(accountId ?? "__none__")}`;
      const [res, loadedContacts] = await Promise.all([
        fetch(`/api/students/${encodeURIComponent(student.student_number)}/messages${query}`),
        loadContacts(),
      ]);
      const data = await res.json();
      setHistory(data);
      const loadedContact = loadedContacts.find((contact) => contact.line_user_id === data.line_user_id) ?? null;
      const selectedAccount = data.selected_account ?? account;
      setSelectedContact(
        accountId && data.line_user_id === accountId && selectedAccount
          ? lineAccountToContact(selectedAccount, loadedContact)
          : loadedContact,
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

  async function linkContact(contact: Contact, relation = registrationRelation) {
    if (!history?.student.student_number) return;
    setLinking(contact.line_user_id);
    try {
      const isPrimary = relation === "student";
      const res = await fetch(`/api/students/${encodeURIComponent(history.student.student_number)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: contact.line_user_id,
          relation,
          alias_name: contact.alias_name ?? contact.display_name,
          is_primary: isPrimary,
        }),
      });
      if (!res.ok) {
        setSendMsg("連絡先の登録に失敗しました");
        return;
      }
      if (isPrimary) setSelectedContact(contact);
      setSendMsg(`${relationLabel(relation)}として登録しました`);
      const student = students.find((item) => item.student_number === history.student.student_number);
      if (student) await openHistory(student, contactToLineAccount(contact, relation));
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
      if (student) await openHistory(student, selectedContact ? contactToLineAccount(selectedContact, "unknown") : null);
      await refreshStudents();
    } finally {
      setSending(false);
    }
  }

  const contactResults = contactSearch.trim()
    ? contacts
        .filter((contact) => matchesContactSearch(contact, contactSearch))
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
            <FilterButtons
              label="校舎"
              options={campusOptions.map((value) => ({ value, label: value }))}
              selected={selectedCampus}
              onSelect={(value) => { setSelectedCampus(value); setSelectedGrade(""); setSelectedSubject(""); setSelectedClassId(""); }}
            />
            {selectedCampus && (
              <FilterButtons
                label="学年"
                options={gradeOptions.map((value) => ({ value, label: value }))}
                selected={selectedGrade}
                onSelect={(value) => { setSelectedGrade(value); setSelectedSubject(""); setSelectedClassId(""); }}
              />
            )}
            {selectedGrade && (
              <FilterButtons
                label="科目"
                options={subjectOptions.map((value) => ({ value, label: value }))}
                selected={selectedSubject}
                onSelect={(value) => { setSelectedSubject(value); setSelectedClassId(""); }}
              />
            )}
            {selectedSubject && (
              <FilterButtons
                label="クラス"
                options={classOptions.map((item) => ({ value: item.id, label: `${item.class_name}（${item.count}名）` }))}
                selected={selectedClassId}
                onSelect={setSelectedClassId}
              />
            )}
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
                      {mode === "class" ? (
                        <>
                          <Th>生徒LINE</Th>
                          <Th>保護者LINE</Th>
                        </>
                      ) : (
                        <Th>LINE</Th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {gradeStudents.flatMap((student) => [
                      <tr
                        key={student.student_number}
                        onClick={() => openHistory(student, studentAccount(student))}
                        style={{
                          borderBottom: guardianAccounts(student).length > 0 ? "none" : "1px solid var(--line)",
                          cursor: "pointer",
                          background: selectedNumber === student.student_number && selectedAccountId === (studentAccount(student)?.line_user_id ?? null) ? "#ecfdf3" : "transparent",
                        }}
                      >
                        <td style={tdMono}>{student.student_number}</td>
                        <td style={tdStrong}>{student.student_name}</td>
                        <td style={td}>{student.homeroom_teacher}</td>
                        {mode === "class" ? (
                          <>
                            <td style={td}><LineAccountColumn student={student} kind="student" /></td>
                            <td style={td}></td>
                          </>
                        ) : (
                          <td style={td}>{student.line_user_id ? `${student.message_count}件` : "未紐づけ"}</td>
                        )}
                      </tr>,
                      ...guardianAccounts(student).map((account, index) => (
                        <tr
                          key={`${student.student_number}:${account.line_user_id}:${index}`}
                          onClick={() => openHistory(student, account)}
                          style={{
                            borderBottom: index === guardianAccounts(student).length - 1 ? "1px solid var(--line)" : "none",
                            cursor: "pointer",
                            background: selectedNumber === student.student_number && selectedAccountId === account.line_user_id ? "#ecfdf3" : "#fafafa",
                          }}
                        >
                          <td style={guardianBlankCell}></td>
                          <td style={guardianAccountCell}>
                            <span>{accountDisplayName(account)}</span>
                          </td>
                          <td style={guardianBlankCell}></td>
                          {mode === "class" ? (
                            <>
                              <td style={guardianBlankCell}></td>
                              <td style={guardianAccountLineCell}>{accountDisplayName(account)}</td>
                            </>
                          ) : (
                            <td style={guardianAccountLineCell}>保護者アカウント</td>
                          )}
                        </tr>
                      )),
                    ])}
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
          ) : history.link_status !== "linked" && registrationRelation === "student" ? (
            <div style={{ padding: 20 }}>
              <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>{history.student.student_name}</h3>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>履歴はありません。</p>
            </div>
          ) : history.link_status !== "linked" ? (
            <div style={{ padding: 20 }}>
              <h3 style={{ fontSize: "0.95rem", marginBottom: 8 }}>{history.student.student_name}</h3>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 12 }}>
                選択中の登録種別にはまだLINE連絡先がありません。登録種別を確認し、LINE表示名や登録名で検索して紐づけてください。
              </p>
                    <div style={registrationRow}>
                      <span style={registrationLabel}>登録種別</span>
                      <select value={registrationRelation} onChange={(e) => setRegistrationRelation(e.target.value)} style={inputStyle}>
                        <option value="guardian">保護者</option>
                        <option value="mother">母</option>
                        <option value="father">父</option>
                        <option value="student">本人</option>
                        <option value="family">家族</option>
                      </select>
                    </div>
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
                        onClick={() => linkContact(contact)}
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
                  {history.student.grade} / {history.student.student_number} / {selectedAccountLabel(selectedContact, registrationRelation)} / {history.messages.length}件
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
                      送信先: <strong>{selectedAccountLabel(selectedContact, registrationRelation)}</strong>
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
                      登録種別を選び、LINE連絡先を検索して送信先として登録します。
                    </p>
                    <div style={registrationRow}>
                      <span style={registrationLabel}>登録種別</span>
                      <select value={registrationRelation} onChange={(e) => setRegistrationRelation(e.target.value)} style={inputStyle}>
                        <option value="guardian">保護者</option>
                        <option value="mother">母</option>
                        <option value="father">父</option>
                        <option value="student">本人</option>
                        <option value="family">家族</option>
                      </select>
                    </div>
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
                          onClick={() => linkContact(contact)}
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
                  placeholder="選択中のLINEアカウントへ送信するメッセージ"
                  rows={3}
                  style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                />
                <button onClick={sendToSelectedStudent} disabled={sending || !selectedContact || !replyText.trim()} style={btnSend}>
                  {sending ? "送信中..." : `${selectedAccountLabel(selectedContact, registrationRelation)}に送信`}
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

function FilterButtons({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 700 }}>{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          style={selected === option.value ? btnActive : btnGhost}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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

function studentAccount(student: Student): LineAccount | null {
  const accounts = student.line_accounts ?? [];
  return accounts.find((account) => account.relation === "student") ??
    accounts.find((account) => account.line_user_id === student.line_user_id) ??
    (student.line_user_id
      ? {
          line_user_id: student.line_user_id,
          relation: "student",
          alias_name: student.student_name,
          friend_display_name: student.student_name,
          is_primary: true,
        }
      : null);
}

function lineAccountToContact(account: LineAccount, fallback: Contact | null = null): Contact {
  const displayName = account.friend_display_name ?? fallback?.display_name ?? null;
  return {
    line_user_id: account.line_user_id,
    display_name: displayName,
    alias_name: account.relation === "student"
      ? account.alias_name ?? fallback?.alias_name ?? displayName
      : displayName ?? account.alias_name ?? fallback?.alias_name ?? relationLabel(account.relation),
  };
}

function selectedAccountLabel(contact: Contact | null, relation: string) {
  const name = relation === "student"
    ? contact?.alias_name ?? contact?.display_name ?? "未登録"
    : contact?.display_name ?? contact?.alias_name ?? "未登録";
  return `${relationLabel(relation)}: ${name}`;
}
function contactToLineAccount(contact: Contact, relation: string): LineAccount {
  return {
    line_user_id: contact.line_user_id,
    relation,
    alias_name: contact.alias_name,
    friend_display_name: contact.display_name,
    is_primary: relation === "student",
  };
}
function guardianAccounts(student: { line_accounts?: LineAccount[] }) {
  const seen = new Set<string>();
  return (student.line_accounts ?? [])
    .filter((account) => ["mother", "father", "guardian", "family"].includes(account.relation))
    .filter((account) => {
      const key = account.alias_name ?? account.friend_display_name ?? account.line_user_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function accountDisplayName(account: LineAccount) {
  if (account.relation !== "student") {
    return account.friend_display_name ?? account.alias_name ?? relationLabel(account.relation);
  }
  return account.alias_name ?? account.friend_display_name ?? "名称未登録";
}
function LineAccountColumn({
  student,
  kind,
}: {
  student: Student;
  kind: "student" | "guardian";
}) {
  const seen = new Set<string>();
  const accounts = (student.line_accounts ?? [])
    .filter((account) => kind === "student" ? account.relation === "student" : account.relation !== "student")
    .filter((account) => {
      const key = account.alias_name ?? account.friend_display_name ?? account.line_user_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (accounts.length === 0) return <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>なし</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {accounts.map((account) => (
        <span key={account.line_user_id} style={{ fontSize: "0.76rem" }}>
          {accountDisplayName(account)}
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

function matchesContactSearch(contact: Contact, query: string) {
  const compact = (value: string | null | undefined) =>
    (value ?? "").normalize("NFKC").replace(/[ \t\r\n\u3000]/g, "").toLowerCase();
  const q = compact(query);
  const labels = [compact(contact.alias_name), compact(contact.display_name)];
  if (labels.some((label) => label.includes(q))) return true;
  const surname = q.slice(0, 2);
  const givenName = q.slice(2);
  return Boolean(
    surname &&
    givenName &&
    labels.some((label) => label.includes(surname) && label.includes(givenName)),
  );
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

const registrationRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "4.5em minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const registrationLabel: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.8rem",
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
const guardianAccountCell: React.CSSProperties = {
  ...td,
  paddingLeft: "2.2em",
  color: "var(--muted)",
  fontSize: "0.82rem",
};

const guardianAccountLineCell: React.CSSProperties = {
  ...td,
  color: "var(--muted)",
  fontSize: "0.82rem",
};

const guardianBlankCell: React.CSSProperties = {
  ...td,
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
