"use client";

import { useEffect, useRef, useState } from "react";
import { buildLineContactAlias, studentRegistrationLabel, studentRegistrationSearchText } from "@/lib/line-contact-registration.mjs";

type Student = { student_number: string; student_name: string; grade?: string | null; campus?: string | null; instruction_type?: string | null; school_name?: string | null };
type Evidence = { id: string; text: string; direction?: string; message_type?: string };
export type LineRegistrationResult = { relation: string; alias: string; studentNumbers: string[] };
type Props = {
  userId: string; displayName?: string | null; source: string;
  students?: Student[]; initialStudentNumber?: string; initialRelation?: string;
  evidence?: Evidence | null; confirmedBy?: string; onConfirmedByChange?: (name: string) => void;
  onSaved: (result: LineRegistrationResult) => Promise<void>; onClose: () => void;
};
const field = { display: "grid", gap: 6 } as const;
const input = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: 10, border: "1px solid #bdcdd2", borderRadius: 7, font: "inherit" } as const;
const button = { padding: "10px 14px", borderRadius: 7, border: "1px solid #adc5ca", background: "white", color: "#194e56", font: "inherit", cursor: "pointer" } as const;
const primary = { ...button, background: "#146471", color: "white" };

export function LineRegistrationForm(props: Props) {
  const [students, setStudents] = useState<Student[]>(props.students ?? []);
  const [messages, setMessages] = useState<Evidence[]>(props.evidence ? [props.evidence] : []);
  const [evidenceId, setEvidenceId] = useState(props.evidence?.id ?? "");
  const [relation, setRelation] = useState(props.initialRelation ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>(props.initialStudentNumber ? [props.initialStudentNumber] : []);
  const [query, setQuery] = useState("");
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [staffName, setStaffName] = useState("");
  const [localOperator, setLocalOperator] = useState("");
  const operator = props.confirmedBy ?? localOperator;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const serial = useRef(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.scrollIntoView({ block: "start" }); }, []);
  const initial = useRef(props);
  useEffect(() => {
    const controller = new AbortController();
    const config = initial.current;
    async function load() {
      setLoading(true); setLoadError("");
      try {
        const get = async (url: string) => { const response = await fetch(url, { signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "登録情報を読み込めませんでした。"); return data; };
        const [roster, detail] = await Promise.all([
          config.students ? Promise.resolve(null) : get("/api/attendance/students"),
          config.evidence !== undefined ? Promise.resolve(null) : get(`/api/admin/contacts/${encodeURIComponent(config.userId)}/messages`),
        ]);
        if (controller.signal.aborted) return;
        if (roster) setStudents(roster.students ?? []);
        if (detail) setMessages((detail.messages ?? []).filter((m: Evidence) => m.direction === "inbound" && m.message_type === "text" && m.text?.trim()));
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "読み込みに失敗しました。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [attempt]);
  const selected = selectedIds.map(id => students.find(s => s.student_number === id)).filter((s): s is Student => Boolean(s));
  const aliasFor = (student: Student) => aliases[student.student_number] ?? (relation ? buildLineContactAlias(student, relation) : "");
  const normalized = query.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
  const matches = students.filter(s => normalized && !selectedIds.includes(s.student_number) && studentRegistrationSearchText(s).includes(normalized)).slice(0, 12);
  const staff = relation === "staff";
  const canSave = staff ? !!staffName.trim() : !!relation && selected.length > 0 && selected.length <= 10 && selected.length === selectedIds.length && selected.every(s => aliasFor(s).trim()) && !!operator.trim() && !!evidenceId;
  async function save() {
    if (serial.current || !canSave || loading || loadError) return;
    const names = staff ? staffName.trim() : selected.map(s => aliasFor(s).trim()).join(" / ");
    if (!window.confirm(`${props.displayName || "このLINE"} を ${names} として登録します。\n${staff ? "先生・スタッフ" : "確認者: " + operator.trim()}\nよろしいですか？`)) return;
    serial.current = true; setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/contacts/${encodeURIComponent(props.userId)}${staff ? "" : "/verify"}`, {
        method: staff ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(staff ? { alias_name: names, group_name: "スタッフ" } : {
          targets: selected.map(s => ({ student_number: s.student_number, relation, alias_name: aliasFor(s).trim(), is_primary: relation === "student" })),
          friend_display_name: props.displayName || null, verified_by: operator.trim(), evidence_message_id: evidenceId, source: props.source,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "登録できませんでした。入力内容を確認してください。");
      setMessage(`${names} として登録しました。一覧の登録名も更新しました。`);
      try { await props.onSaved({ relation, alias: names, studentNumbers: selectedIds }); }
      catch { setMessage(`${names} として登録しました。一覧を更新できなかったため、画面を再読み込みしてください。`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "登録できませんでした。"); }
    finally { serial.current = false; setSaving(false); }
  }
  return <section ref={root} aria-label="生徒本人・保護者のLINE登録" style={{ border: "2px solid #0891b2", borderRadius: 10, padding: 16, display: "grid", gap: 14, background: "white", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}><strong style={{ fontSize: 17 }}>生徒本人・保護者のLINE登録</strong><button type="button" style={button} disabled={saving} onClick={props.onClose}>LINE登録を閉じる</button></div>
    <p style={{ margin: 0 }}>相手のLINE表示名：<strong>{props.displayName || "表示名なし"}</strong></p>
    <small>表示名が未確定・登録を修正したいときに設定します。毎回の登録は不要です。</small>
    {loading && <p role="status">登録情報を読み込んでいます…</p>}
    {loadError && <div role="alert">{loadError} <button type="button" style={button} onClick={() => setAttempt(a => a + 1)}>読み込みを再試行</button></div>}
    <fieldset disabled={saving || loading || !!loadError} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: "grid", gap: 14 }}>
      <div style={field}><strong>確認に使うLINE本文</strong><small>氏名と続柄が分かる受信メッセージを選んでください。</small>
        <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 8 }}>{messages.map(m => <button type="button" key={m.id} aria-pressed={evidenceId === m.id} style={{ ...button, textAlign: "left", whiteSpace: "pre-wrap", overflowWrap: "anywhere", border: evidenceId === m.id ? "2px solid #0891b2" : button.border, background: evidenceId === m.id ? "#ecfeff" : "white" }} onClick={() => setEvidenceId(m.id)}>{m.text}</button>)}</div>
        {!messages.length && <small>確認できる受信メッセージがありません。生徒・保護者の登録にはLINE本文が必要です。</small>}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><legend style={{ fontWeight: 700, marginBottom: 8 }}>1. LINEの利用者を選ぶ</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>{[["student", "生徒本人"], ["guardian", "保護者"], ["shared", "本人・保護者で共有"], ["staff", "先生・スタッフ"]].map(([value, label]) => <button type="button" key={value} aria-pressed={value === "guardian" ? ["guardian", "mother", "father", "family"].includes(relation) : value === relation} style={(value === "guardian" ? ["guardian", "mother", "father", "family"].includes(relation) : value === relation) ? primary : button} onClick={() => { setRelation(value); setAliases({}); setMessage(""); }}>{label}</button>)}</div>
        {["guardian", "mother", "father", "family"].includes(relation) && <label style={{ ...field, marginTop: 10 }}>保護者の続柄<select style={input} value={relation} onChange={e => { setRelation(e.target.value); setAliases({}); }}><option value="guardian">保護者</option><option value="mother">母</option><option value="father">父</option><option value="family">家族</option></select></label>}
      </fieldset>
      {staff ? <div style={field}><strong>2. 先生・スタッフの名前を入力</strong><label style={field}>先生・スタッフの登録名<input style={input} maxLength={200} value={staffName} onChange={e => setStaffName(e.target.value)} /></label><small>「スタッフ」グループに登録します。</small></div> : <div style={field}>
        <strong>2. 対象の生徒を選ぶ</strong><small>保護者のLINEの場合も、お子さまの名前を選びます。兄弟も同じLINEなら追加できます。</small>
        <label style={field}>生徒を検索<input style={input} value={query} onChange={e => setQuery(e.target.value)} placeholder="氏名・学年・校舎・学校・生徒番号で検索" /></label>
        {matches.map(s => <button type="button" key={s.student_number} disabled={selectedIds.length >= 10} style={{ ...button, textAlign: "left" }} onClick={() => { setSelectedIds(ids => [...ids, s.student_number]); setQuery(""); }}>{studentRegistrationLabel(s)}</button>)}
        {normalized && !matches.length && <small>該当する未選択の生徒が見つかりません。</small>}
        {selectedIds.length >= 10 && <small>一度に登録できる生徒は10名までです。</small>}
        {selectedIds.filter(id => !students.some(s => s.student_number === id)).map(id => <button type="button" key={id} style={button} onClick={() => setSelectedIds(ids => ids.filter(value => value !== id))}>名簿にない選択候補を外す</button>)}
        {selected.map(s => <div key={s.student_number} style={{ padding: 10, background: "#eff8f3", borderRadius: 7, display: "grid", gap: 6 }}><strong>{studentRegistrationLabel(s)}</strong><button type="button" style={button} onClick={() => setSelectedIds(ids => ids.filter(id => id !== s.student_number))}>{s.student_name} を外す</button></div>)}
      </div>}
      <div style={field}><strong>3. 表示名を確認して登録</strong><small>登録すると、この一覧と連絡先管理の名前が更新されます。</small>
        {!staff && <>{selected.map(s => <label key={s.student_number} style={field}>登録後に一覧へ表示する名前{selected.length > 1 ? `（${s.student_name}）` : ""}<input style={input} maxLength={200} disabled={!relation} value={aliasFor(s)} onChange={e => setAliases(a => ({ ...a, [s.student_number]: e.target.value }))} /></label>)}{props.confirmedBy === undefined ? <label style={field}>LINE登録の確認者名<input style={input} value={localOperator} onChange={e => setLocalOperator(e.target.value)} /></label> : !operator.trim() && <small>画面上部の確認者名・スタッフ名を入力してください。</small>}</>}
        <button type="button" style={primary} disabled={!canSave} onClick={() => void save()}>{saving ? "登録中..." : staff ? "先生・スタッフとして保存して一覧を更新" : "この内容で登録して一覧の名前を更新"}</button>
      </div>
    </fieldset>
    {message && <p role="status" style={{ margin: 0, fontWeight: 700 }}>{message}</p>}
  </section>;
}
