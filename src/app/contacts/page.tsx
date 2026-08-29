"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

import { parseLineAliasCsv } from "@/lib/line-alias-import.mjs";
import { buildLineContactAlias, classifyLineContact, relationLabel } from "@/lib/line-contact-registration.mjs";

type RosterImportFile = { file: string; status?: string };
type RosterImportPreview = { changed?: boolean; first_import?: boolean; message?: string; files?: RosterImportFile[]; changed_files?: RosterImportFile[]; students?: number; class_enrollments?: number; skipped?: boolean };

type Contact = {
  line_user_id: string;
  display_name: string | null;
  alias_name: string | null;
  group_name: string | null;
  latest_message_at?: string | null;
  latest_text?: string | null;
  registered_accounts?: RegisteredAccount[];
  system_verified?: boolean;
  pending_evidence?: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  registration_state?: "pending" | "system_registered" | "other";
};

type RegisteredAccount = {
  student_number: string;
  student_name: string;
  grade: string;
  relation: string;
  alias_name: string | null;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
  evidence_message_id: string | null;
  verification_source: string | null;
};
type ContactMessage = { id: string; direction: string; text: string | null; message_type: string; received_at: string | null; created_at: string; sent_by: string | null };
type ContactDetail = {
  messages: ContactMessage[];
  identity_evidence: { detected_message_id: string | null; evidence_text: string; evidence_at: string | null; parsed_student_name: string | null; relation: string; review_status: string } | null;
  registration_history: { id: string; student_number: string | null; action: string; relation: string | null; alias_name: string | null; performed_by: string; source: string; created_at: string; evidence_message_id: string | null }[];
};
type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type ContactTab = "pending" | "system_registered" | "other" | "all";

type AliasImportStatus = "insert" | "same_existing" | "different_existing" | "conflict" | "unmatched";
type AliasImportRow = {
  id: string;
  source_row: number;
  line_user_id: string;
  alias_name: string;
  display_name: string;
  group_name: string;
  status: AliasImportStatus;
  enabled: boolean;
  can_apply: boolean;
  existing_alias_name: string | null;
  expected_existing_alias_name: string | null;
  note: string;
};

const importStatusLabel: Record<AliasImportStatus, string> = {
  insert: "新規",
  same_existing: "一致",
  different_existing: "変更",
  conflict: "競合",
  unmatched: "照合不能",
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
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<AliasImportRow[]>([]);
  const [rosterImportMsg, setRosterImportMsg] = useState<string | null>(null);
  const [rosterImportPreview, setRosterImportPreview] = useState<RosterImportPreview | null>(null);
  const [rosterImporting, setRosterImporting] = useState(false);
  const [contactTab, setContactTab] = useState<ContactTab>("pending");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactDetail, setContactDetail] = useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudentNumber, setSelectedStudentNumber] = useState("");
  const [selectedRelation, setSelectedRelation] = useState("mother");
  const [selectedEvidenceMessageId, setSelectedEvidenceMessageId] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [verificationMsg, setVerificationMsg] = useState<string | null>(null);
  const [helperSyncing, setHelperSyncing] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    const saved = window.localStorage.getItem("line-contact-operator-name") ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOperatorName(saved);
  }, []);

  function updateOperatorName(value: string) {
    setOperatorName(value);
    window.localStorage.setItem("line-contact-operator-name", value);
  }

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
    setImportRows([]);
    setImportFileName(file.name);
    try {
      const rows = parseLineAliasCsv(await file.text());
      const res = await fetch("/api/admin/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "差分確認に失敗しました");
      setImportRows(data.rows ?? []);
      setImportMsg("差分を確認しました。新規は選択済み、既存名の変更は未選択です。");
    } catch (error) {
      setImportFileName(null);
      setImportMsg(error instanceof Error ? error.message : "エラーが発生しました。");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  function toggleImportRow(id: string) {
    setImportRows((current) => current.map((row) =>
      row.id === id && row.can_apply ? { ...row, enabled: !row.enabled } : row,
    ));
  }

  async function confirmAliasImport() {
    const selected = importRows.filter((row) => row.enabled && row.can_apply);
    if (selected.length === 0) return;
    const changes = selected.filter((row) => row.status === "different_existing").length;
    const detail = changes > 0 ? `\nこのうち${changes}件は既存の登録名を変更します。` : "";
    if (!window.confirm(`${selected.length}件のLINE登録名を反映します。${detail}\nよろしいですか？`)) return;
    setImporting(true);
    setImportMsg("登録名を反映しています...");
    try {
      const response = await fetch("/api/admin/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          rows: selected,
          performed_by: operatorName.trim() || null,
          source: importFileName === "LINE管理画面から直接同期" ? "local_line_manager_helper" : "csv_upload",
          source_name: importFileName,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "登録名の反映に失敗しました");
      setImportRows([]);
      setImportFileName(null);
      setImportMsg(body.message ?? `${body.imported ?? 0}件を反映しました。`);
      await fetchContacts();
    } catch (error) {
      setImportMsg(error instanceof Error ? error.message : "登録名の反映に失敗しました");
    } finally {
      setImporting(false);
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

  async function handleRosterImportClick() {
    setRosterImporting(true);
    setRosterImportMsg("クラス一覧表を確認しています...");
    setRosterImportPreview(null);
    try {
      const response = await fetch("/api/admin/roster-import");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "クラス一覧表の確認に失敗しました");
      setRosterImportPreview(body);
      const files = body.first_import ? body.files ?? [] : body.changed_files ?? [];
      if (body.first_import) {
        setRosterImportMsg(`初回取り込みです。フォルダ内のクラス一覧表 ${files.length}件を表示しています。`);
      } else if (body.changed) {
        setRosterImportMsg(`新しくなっていたクラス一覧表 ${files.length}件を取り込みます。`);
      } else {
        setRosterImportMsg("前回取り込み後に新しくなったクラス一覧表はありません。");
      }
    } catch (error) {
      setRosterImportMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setRosterImporting(false);
    }
  }

  async function confirmRosterImport() {
    if (!rosterImportPreview?.changed) return;
    const files = rosterImportPreview.first_import ? rosterImportPreview.files ?? [] : rosterImportPreview.changed_files ?? [];
    if (!window.confirm(`${files.map((file) => file.file).join("\n")}\n\nこれらのファイルを取り込みます。よろしいですか？`)) return;
    setRosterImporting(true);
    setRosterImportMsg("クラス一覧表を取り込んでいます...");
    try {
      const response = await fetch("/api/admin/roster-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "クラス一覧表の取り込みに失敗しました");
      setRosterImportPreview(body);
      setRosterImportMsg(body.skipped ? "新しくなったクラス一覧表はありません。" : `${body.students}名、${body.class_enrollments}件のクラス登録を取り込みました。`);
    } catch (error) {
      setRosterImportMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setRosterImporting(false);
    }
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
        setBroadcastMsg(data.line_delivered
          ? `LINEへの一斉送信は完了しましたが履歴保存に失敗しました（${data.sent ?? 0}件）。再送しないでください`
          : data.error ?? "送信に失敗しました");
      }
    } finally {
      setBroadcasting(false);
    }
  }

  async function syncFromLineManager() {
    setHelperSyncing(true);
    setImportMsg("事務所PCのLINE管理画面から登録名を取得しています...");
    setImportRows([]);
    try {
      const helperResponse = await fetch("http://127.0.0.1:39123/sync", { method: "POST" });
      const helperBody = await helperResponse.json().catch(() => ({}));
      if (!helperResponse.ok) throw new Error(helperBody.error ?? "LINE同期ヘルパーに接続できませんでした");
      const response = await fetch("/api/admin/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", rows: helperBody.rows ?? [], source: "local_line_manager_helper" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "差分確認に失敗しました");
      setImportFileName("LINE管理画面から直接同期");
      setImportRows(body.rows ?? []);
      setImportMsg("取得が完了しました。新規は選択済みです。変更は内容を確認して選択してください。");
    } catch (error) {
      setImportMsg(`${error instanceof Error ? error.message : String(error)}。専用LINE管理画面が開いた場合はログイン後、もう一度押してください。`);
    } finally {
      setHelperSyncing(false);
    }
  }

  async function openContactDetail(contact: Contact) {
    setSelectedContact(contact);
    setContactDetail(null);
    setVerificationMsg(null);
    setDetailLoading(true);
    try {
      const [detailResponse, studentsResponse] = await Promise.all([
        fetch(`/api/admin/contacts/${encodeURIComponent(contact.line_user_id)}/messages?limit=40`),
        students.length > 0 ? Promise.resolve(null) : fetch("/api/attendance/students"),
      ]);
      const detailBody = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) throw new Error(detailBody.error ?? "LINEメッセージを取得できませんでした");
      const loadedStudents = studentsResponse
        ? ((await studentsResponse.json().catch(() => ({}))).students ?? []) as Student[]
        : students;
      if (studentsResponse && !studentsResponse.ok) throw new Error("生徒一覧を取得できませんでした");
      if (studentsResponse) setStudents(loadedStudents);
      setContactDetail(detailBody as ContactDetail);
      const evidence = (detailBody as ContactDetail).identity_evidence;
      setSelectedEvidenceMessageId(evidence?.detected_message_id ?? "");
      setSelectedRelation(evidence?.relation && evidence.relation !== "unknown" ? evidence.relation : "mother");
      setStudentQuery(evidence?.parsed_student_name ?? "");
      const normalizedEvidenceName = (evidence?.parsed_student_name ?? "").normalize("NFKC").replace(/[\s　]/g, "");
      const match = loadedStudents.find((student) => student.student_name.normalize("NFKC").replace(/[\s　]/g, "") === normalizedEvidenceName);
      setSelectedStudentNumber(match?.student_number ?? "");
    } catch (error) {
      setVerificationMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  }

  async function verifySelectedContact() {
    if (!selectedContact || !contactDetail) return;
    const student = students.find((row) => row.student_number === selectedStudentNumber);
    if (!operatorName.trim()) { setVerificationMsg("確認者名を入力してください。"); return; }
    if (!student) { setVerificationMsg("登録する生徒を選択してください。"); return; }
    if (!selectedEvidenceMessageId) { setVerificationMsg("確認に使ったLINEメッセージを選択してください。"); return; }
    const aliasName = buildLineContactAlias(student, selectedRelation);
    if (!window.confirm(`LINEメッセージを確認済みとして、\n${student.grade} ${student.student_name}（${relationLabel(selectedRelation)}）\n登録名「${aliasName}」で登録します。\n\n確認者: ${operatorName.trim()}`)) return;
    setVerificationSaving(true);
    setVerificationMsg("登録しています...");
    try {
      const response = await fetch(`/api/admin/contacts/${encodeURIComponent(selectedContact.line_user_id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: [{ student_number: student.student_number, relation: selectedRelation, alias_name: aliasName, is_primary: selectedRelation === "student" }],
          friend_display_name: selectedContact.display_name,
          verified_by: operatorName.trim(),
          evidence_message_id: selectedEvidenceMessageId,
          source: "contacts_review",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "登録に失敗しました");
      await fetchContacts();
      setContactTab("system_registered");
      await openContactDetail({ ...selectedContact, alias_name: aliasName, system_verified: true, registration_state: "system_registered" });
      setVerificationMsg(`${aliasName}として本人確認済みに登録しました。`);
    } catch (error) {
      setVerificationMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setVerificationSaving(false);
    }
  }

  const tabCounts = contacts.reduce((counts, contact) => {
    counts[classifyLineContact(contact) as Exclude<ContactTab, "all">] += 1;
    return counts;
  }, { pending: 0, system_registered: 0, other: 0 });

  const filtered = contacts.filter((c) => {
    if (contactTab !== "all" && classifyLineContact(c) !== contactTab) return false;
    if (groupFilter !== "全て" && c.group_name !== groupFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.alias_name ?? "").toLowerCase().includes(q) ||
      (c.display_name ?? "").toLowerCase().includes(q) ||
      (c.registered_accounts ?? []).some((account) => account.student_name.toLowerCase().includes(q) || account.student_number.toLowerCase().includes(q)) ||
      c.line_user_id.toLowerCase().includes(q)
    );
  });
  const selectedStudent = students.find((student) => student.student_number === selectedStudentNumber) ?? null;
  const normalizedStudentQuery = studentQuery.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
  const matchingStudents = students.filter((student) => {
    if (!normalizedStudentQuery) return false;
    const haystack = `${student.student_number}${student.student_name}${student.grade}`.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
    return haystack.includes(normalizedStudentQuery);
  }).slice(0, 8);
  const selectedAlias = selectedStudent ? buildLineContactAlias(selectedStudent, selectedRelation) : "";

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
        LINEメッセージを確認して生徒・続柄を登録し、確認済みの連絡先を一覧で管理します。候補だけで自動登録されることはありません。
      </p>

      <div style={{ display: "grid", gap: 6, marginBottom: 16, maxWidth: 360 }}>
        <label htmlFor="contact-operator" style={{ fontSize: "0.85rem", fontWeight: 700 }}>操作するスタッフ名</label>
        <input id="contact-operator" value={operatorName} onChange={(event) => updateOperatorName(event.target.value)} placeholder="例：吉川" style={inputStyle} />
        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>本人確認の履歴に保存されます。この端末では次回も同じ名前を表示します。</span>
      </div>

      {/* LINE登録名インポート */}
      <div id="line-alias-import" style={{ display: "grid", gap: 12, marginBottom: 16, padding: "14px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)", scrollMarginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ fontSize: "0.9rem" }}>LINE管理画面の登録名を同期</strong>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>①取得 → ②差分確認 → ③選択した内容だけ確定</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void syncFromLineManager()} style={btnSave} disabled={helperSyncing || importing}>
            {helperSyncing ? "LINE管理画面から取得中..." : "LINE登録名を同期する"}
          </button>
          <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>通常はこちらを使用します。専用LINE管理画面のログインが切れている場合だけログイン画面が開きます。</span>
        </div>
        <details>
          <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.8rem" }}>予備：CSVファイルから取り込む</summary>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <label style={{ ...btnEdit, cursor: importing ? "default" : "pointer", display: "inline-flex", alignItems: "center" }}>
            {importing ? "処理中…" : "CSVを選択"}
            <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} disabled={importing} style={{ display: "none" }} />
          </label>
          </div>
        </details>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {importFileName && <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{importFileName}</span>}
          {importMsg && <span role="status" style={{ fontSize: "0.82rem", color: importMsg.includes("失敗") || importMsg.includes("必要") || importMsg.includes("接続") ? "#dc2626" : "var(--muted)" }}>{importMsg}</span>}
        </div>
        {importRows.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.78rem" }}>
              {(Object.keys(importStatusLabel) as AliasImportStatus[]).map((status) => {
                const count = importRows.filter((row) => row.status === status).length;
                return count > 0 ? <span key={status} style={statusBadge(status)}>{importStatusLabel[status]} {count}件</span> : null;
              })}
            </div>
            <div style={{ overflowX: "auto", maxHeight: 360, border: "1px solid var(--line)", borderRadius: 6 }}>
              <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--background)", zIndex: 1 }}>
                  <tr><Th>反映</Th><Th>判定</Th><Th>LINE名</Th><Th>現在の登録名</Th><Th>取込後の登録名</Th></tr>
                </thead>
                <tbody>
                  {importRows.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--line)", opacity: row.can_apply ? 1 : 0.72 }}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          disabled={!row.can_apply || importing}
                          onChange={() => toggleImportRow(row.id)}
                          aria-label={`${row.alias_name || row.note}を反映`}
                        />
                      </td>
                      <td style={td}><span style={statusBadge(row.status)}>{importStatusLabel[row.status]}</span></td>
                      <td style={td}>
                        <div>{row.display_name || "名前未取得"}</div>
                        <div style={{ color: "var(--muted)", fontFamily: "Consolas, monospace", fontSize: "0.67rem" }}>{row.line_user_id || `CSV ${row.source_row}行目`}</div>
                        {row.note && <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }}>{row.note}</div>}
                      </td>
                      <td style={td}>{row.existing_alias_name || "—"}</td>
                      <td style={{ ...td, fontWeight: row.status === "insert" || row.status === "different_existing" ? 700 : 400 }}>{row.alias_name || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={confirmAliasImport}
                disabled={importing || !importRows.some((row) => row.enabled && row.can_apply)}
                style={btnSave}
              >
                選択した {importRows.filter((row) => row.enabled && row.can_apply).length} 件を確定
              </button>
              <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>「変更」は内容を確認してチェックした場合だけ上書きします。競合・照合不能は反映しません。</span>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 16, padding: "12px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.875rem", color: "var(--muted)", flexShrink: 0 }}>クラス一覧表:</span>
          <button onClick={handleRosterImportClick} style={btnEdit} disabled={rosterImporting}>
            {rosterImporting ? "確認中..." : "取り込み"}
          </button>
          {rosterImportPreview?.changed && (
            <button onClick={confirmRosterImport} style={btnSave} disabled={rosterImporting}>
              確定
            </button>
          )}
          {rosterImportMsg && <span style={{ fontSize: "0.875rem", color: rosterImportMsg.includes("失敗") ? "#dc2626" : "var(--muted)" }}>{rosterImportMsg}</span>}
        </div>
        {rosterImportPreview && (
          <div style={{ display: "grid", gap: 4, fontSize: "0.82rem", color: "var(--muted)" }}>
            {(rosterImportPreview.first_import ? rosterImportPreview.files ?? [] : rosterImportPreview.changed_files ?? []).map((file) => (
              <span key={file.file}>・{file.file}</span>
            ))}
          </div>
        )}
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

      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([
            ["pending", `要確認 ${tabCounts.pending}`],
            ["system_registered", `本人確認済み ${tabCounts.system_registered}`],
            ["other", `取込のみ・その他 ${tabCounts.other}`],
            ["all", `すべて ${contacts.length}`],
          ] as [ContactTab, string][]).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setContactTab(value)} style={contactTab === value ? btnSave : btnEdit}>{label}</button>
          ))}
        </div>
        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
          「本人確認済み」は、スタッフが実際のLINEメッセージを確認し、生徒・続柄を確定した連絡先だけです。LINE管理名を取り込んだだけの連絡先とは分けて表示します。
        </span>
      </div>

      {selectedContact && (
        <section className="panel" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 12, border: "2px solid #67e8f9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong>{selectedContact.alias_name ?? selectedContact.display_name ?? "名前未取得"} の本人確認</strong>
              <div style={{ color: "var(--muted)", fontSize: "0.76rem", marginTop: 3 }}>LINE表示名：{selectedContact.display_name ?? "未取得"}</div>
            </div>
            <button type="button" style={btnCancel} onClick={() => { setSelectedContact(null); setContactDetail(null); }}>閉じる</button>
          </div>
          {detailLoading ? <p style={{ color: "var(--muted)" }}>メッセージを読み込んでいます...</p> : contactDetail && (
            <>
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ color: "#155e75" }}>① 本人・生徒名・続柄をメッセージで確認</strong>
                <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>登録根拠にする受信メッセージを1つ選んでください。名前や続柄が判断できない場合は登録しません。</span>
                <div style={{ maxHeight: 300, overflowY: "auto", display: "grid", gap: 7, padding: 2 }}>
                  {contactDetail.messages.map((message) => {
                    const selectable = message.direction === "inbound" && message.message_type === "text" && Boolean(message.text?.trim());
                    const selected = selectedEvidenceMessageId === message.id;
                    return <button key={message.id} type="button" disabled={!selectable} onClick={() => selectable && setSelectedEvidenceMessageId(message.id)} style={{ border: selected ? "3px solid #0891b2" : "1px solid var(--line)", borderRadius: 7, padding: 10, textAlign: "left", background: message.direction === "inbound" ? (selected ? "#ecfeff" : "white") : "#f7f7f4", cursor: selectable ? "pointer" : "default", opacity: selectable ? 1 : 0.72 }}>
                      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.7rem", marginBottom: 4 }}>{message.direction === "inbound" ? "相手から受信" : `教室から送信${message.sent_by ? `（${message.sent_by}）` : ""}`} / {formatDateTime(message.received_at ?? message.created_at)}{selected ? " / 登録根拠に選択中" : ""}</span>
                      <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{message.text ?? `（${message.message_type}）`}</span>
                    </button>;
                  })}
                  {contactDetail.messages.length === 0 && <div style={{ padding: 12, color: "#b42318" }}>確認できるLINEメッセージがありません。この連絡先は本人確認済みにできません。</div>}
                </div>
              </div>

              {!selectedContact.system_verified && <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <strong>②〜④ 登録内容を選択</strong>
                <label style={{ display: "grid", gap: 5 }}>② 生徒を名前・学年・生徒番号で検索
                  <input style={inputStyle} value={studentQuery} onChange={(event) => { setStudentQuery(event.target.value); setSelectedStudentNumber(""); }} placeholder="例：山田太郎" />
                </label>
                {matchingStudents.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {matchingStudents.map((student) => <button key={student.student_number} type="button" onClick={() => { setSelectedStudentNumber(student.student_number); setStudentQuery(student.student_name); }} style={selectedStudentNumber === student.student_number ? btnSave : btnEdit}>{student.grade} {student.student_name}</button>)}
                </div>}
                {studentQuery && matchingStudents.length === 0 && !selectedStudent && <span style={{ color: "#b42318", fontSize: "0.8rem" }}>該当する生徒が見つかりません。</span>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 5 }}>③ 生徒との続柄
                    <select style={inputStyle} value={selectedRelation} onChange={(event) => setSelectedRelation(event.target.value)}>
                      <option value="mother">母</option><option value="father">父</option><option value="student">本人</option><option value="guardian">保護者</option><option value="family">家族</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 5 }}>④ 教室で表示する登録名
                    <div style={{ ...inputStyle, background: "#f7f7f4", fontWeight: 700 }}>{selectedAlias || "生徒を選択してください"}</div>
                  </label>
                </div>
                <button type="button" onClick={() => void verifySelectedContact()} disabled={verificationSaving || !operatorName.trim() || !selectedStudent || !selectedEvidenceMessageId} style={{ ...btnSave, padding: "11px 16px", justifySelf: "start" }}>
                  {verificationSaving ? "登録中..." : "この内容で本人確認済みに登録"}
                </button>
              </div>}

              {(selectedContact.registered_accounts ?? []).length > 0 && <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <strong>現在の生徒紐付け</strong>
                {(selectedContact.registered_accounts ?? []).map((account) => <div key={`${account.student_number}-${account.relation}`} style={{ padding: 9, border: "1px solid var(--line)", borderRadius: 6 }}>
                  {account.grade} {account.student_name} / {relationLabel(account.relation)} / {account.alias_name ?? "登録名なし"}
                  <div style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{account.verification_status === "confirmed" ? `本人確認済み：${account.verified_by ?? "確認者不明"} / ${formatDateTime(account.verified_at)}` : "取込・推定による紐付け（本人確認未完了）"}</div>
                </div>)}
              </div>}

              {contactDetail.registration_history.length > 0 && <details><summary style={{ cursor: "pointer", fontWeight: 700 }}>登録履歴 {contactDetail.registration_history.length}件</summary>
                <div style={{ display: "grid", gap: 5, marginTop: 8 }}>{contactDetail.registration_history.map((event) => <div key={event.id} style={{ color: "var(--muted)", fontSize: "0.76rem" }}>{formatDateTime(event.created_at)} / {event.performed_by} / {event.alias_name ?? event.action}</div>)}</div>
              </details>}
            </>
          )}
          {verificationMsg && <p role="status" style={{ color: verificationMsg.includes("登録しました") ? "#087a3d" : "#b42318", fontWeight: 700 }}>{verificationMsg}</p>}
        </section>
      )}

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
                <Th>確認状態</Th>
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
                    <div style={{ display: "grid", gap: 3 }}>
                      <span style={{ color: c.display_name ? "var(--muted)" : "var(--foreground)", fontSize: "0.875rem", fontWeight: c.display_name ? 400 : 700 }}>
                        {c.display_name ?? c.alias_name ?? "名前未取得"}
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                        {c.display_name ? "LINE名取得済み" : "LINE名未取得"}
                      </span>
                      <span style={{ color: "var(--muted)", fontFamily: "Consolas, monospace", fontSize: "0.68rem" }}>{c.line_user_id}</span>
                    </div>
                  </td>
                  <td style={td}>
                    {classifyLineContact(c) === "system_registered" ? <div style={{ display: "grid", gap: 3 }}><span style={{ ...statusBadge("same_existing"), color: "#087a3d" }}>本人確認済み</span><span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>{(c.registered_accounts ?? []).map((account) => `${account.student_name}（${relationLabel(account.relation)}）`).join(" / ")}</span></div>
                      : classifyLineContact(c) === "pending" ? <span style={{ ...statusBadge("different_existing"), color: "#9a3412" }}>メッセージ確認待ち</span>
                      : <span style={{ ...statusBadge("unmatched"), color: "#555" }}>取込のみ・未確認</span>}
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
                      <button onClick={() => void openContactDetail(c)} disabled={detailLoading && selectedContact?.line_user_id === c.line_user_id} style={classifyLineContact(c) === "pending" ? btnSave : btnEdit}>
                        {classifyLineContact(c) === "pending" ? "メッセージを確認して登録" : "メッセージ・履歴"}
                      </button>
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "11px 16px", textAlign: "left", fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function statusBadge(status: AliasImportStatus): React.CSSProperties {
  const colors: Record<AliasImportStatus, { color: string; background: string }> = {
    insert: { color: "#166534", background: "#dcfce7" },
    same_existing: { color: "#475569", background: "#e2e8f0" },
    different_existing: { color: "#9a3412", background: "#ffedd5" },
    conflict: { color: "#991b1b", background: "#fee2e2" },
    unmatched: { color: "#6b21a8", background: "#f3e8ff" },
  };
  return {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
    ...colors[status],
  };
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


