"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LineRegistrationForm } from "@/app/LineRegistrationForm";
import { relationLabel } from "@/lib/line-contact-registration.mjs";
import type { RegistrationChange } from "./navigation";
import styles from "./workspace.module.css";
type Account = { student_number: string; student_name?: string; relation: string; verification_status?: string; alias_name?: string | null };
type Contact = { line_user_id: string; display_name?: string | null; alias_name?: string | null; group_name?: string | null; registered_accounts?: Account[] };
type Params = Record<string, string | string[] | undefined>;
const value = (params: Params, key: string) => typeof params[key] === "string" ? params[key] as string : "";
const returns: Record<string, string> = { "/attendance": "欠席確認", "/contacts": "連絡先管理", "/students": "生徒一覧" };
export default function RegistrationWorkspace({ params, overlay = false }: { params: Params; overlay?: boolean }) {
  const router = useRouter();
  const userId = value(params, "userId");
  const returnTo = Object.hasOwn(returns, value(params, "returnTo")) ? value(params, "returnTo") : "/contacts";
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState(value(params, "mode") === "name" ? "name" : "register");
  const [alias, setAlias] = useState("");
  const [operator, setOperator] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const serial = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError(""); setContact(null);
      try {
        if (!userId) throw new Error("対象のLINEが指定されていません。連絡先管理から相手を選んでください。");
        const response = await fetch(`/api/admin/contacts?userId=${encodeURIComponent(userId)}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "登録情報を読み込めませんでした。");
        const found = (body.contacts ?? []).find((item: Contact) => item.line_user_id === userId);
        if (!found) throw new Error("対象のLINE連絡先が見つかりません。元の画面で最新状態を確認してください。");
        setContact(found); setAlias(found.alias_name ?? found.display_name ?? "");
        try { setOperator(sessionStorage.getItem("line-registration-operator") ?? localStorage.getItem("line-contact-operator-name") ?? ""); } catch {}
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "読み込みに失敗しました。"); }
    }
    void load(); return () => controller.abort();
  }, [userId, attempt]);
  useEffect(() => {
    if (!overlay) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = document.querySelector<HTMLElement>(".app-frame");
    const oldInert = frame?.inert;
    const oldOverflow = document.body.style.overflow;
    if (frame) frame.inert = true;
    document.body.style.overflow = "hidden";
    backButton.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? []).filter(item => item.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => { if (frame) frame.inert = oldInert ?? false; document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", trap); requestAnimationFrame(() => previousFocus?.focus({ preventScroll: true })); };
  }, [overlay]);
  useEffect(() => {
    const failed = () => setRefreshError(true);
    window.addEventListener("line-registration-refresh-error", failed);
    return () => window.removeEventListener("line-registration-refresh-error", failed);
  }, []);
  const accounts = (contact?.registered_accounts ?? []).filter(account => account.verification_status === "confirmed");
  const studentNumber = value(params, "student");
  const studentName = value(params, "studentName").slice(0, 200);
  const studentAccount = accounts.find(account => account.student_number === studentNumber && account.relation === "student");
  function updateOperator(name: string) { setOperator(name); try { sessionStorage.setItem("line-registration-operator", name); localStorage.setItem("line-contact-operator-name", name); } catch {} }
  function goBack() { if (saving) return; if (overlay) router.back(); else router.replace(returnTo); }
  async function announce(change: RegistrationChange) {
    setSaved(true);
    window.dispatchEvent(new CustomEvent("line-registration-saved", { detail: change }));
    try {
      const response = await fetch(`/api/admin/contacts?userId=${encodeURIComponent(userId)}`);
      const body = await response.json();
      const current = (body.contacts ?? []).find((item: Contact) => item.line_user_id === userId);
      if (!response.ok || !current) throw new Error("登録情報を更新できませんでした");
      setContact(current);
    } catch { setRefreshError(true); }
  }
  async function saveName() {
    if (serial.current || !contact || !alias.trim() || (studentAccount && !operator.trim())) return;
    serial.current = true; setSaving(true); setMessage("");
    try {
      const url = studentAccount ? `/api/students/${encodeURIComponent(studentNumber)}/line-name` : `/api/admin/contacts/${encodeURIComponent(userId)}`;
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(studentAccount ? { line_user_id: userId, alias_name: alias.trim(), performed_by: operator.trim() } : { alias_name: alias.trim() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "登録名を保存できませんでした。");
      setContact(current => current ? { ...current, alias_name: alias.trim() } : current);
      setMessage(`${alias.trim()} に変更しました。`);
      await announce({ userId, alias: alias.trim() });
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "保存できませんでした。"); }
    finally { serial.current = false; setSaving(false); }
  }
  return <div ref={root} className={overlay ? styles.overlay : undefined} role={overlay ? "dialog" : undefined} aria-modal={overlay ? true : undefined} aria-label="LINE登録・修正">
    <div className={styles.page}>
      <header className={styles.header}><button ref={backButton} type="button" className={styles.button} disabled={saving} onClick={goBack}>← {returns[returnTo]}に戻る</button><h1>LINE登録・修正</h1></header>
      {error ? <section className={styles.panel} role="alert"><p>{error}</p>{userId && <button className={styles.button} onClick={() => setAttempt(n => n + 1)}>読み込みを再試行</button>}</section> : !contact ? <p role="status">登録情報を読み込んでいます…</p> : <>
        <section className={styles.panel}><p>相手のLINE表示名：<strong>{contact.display_name || "表示名なし"}</strong></p><p>現在の登録名：<strong>{contact.alias_name || "未登録"}</strong></p><p>現在の確認済み紐付け：{accounts.length ? accounts.map(account => `${account.student_name || account.student_number}（${relationLabel(account.relation)}）`).join(" / ") : "なし"}</p></section>
        {studentNumber && studentName && <section className={styles.panel} aria-label="今回確認する生徒">
          <p>今回確認する生徒：<strong>{studentName}さん</strong>・学籍番号 {studentNumber}</p>
          {accounts.length > 0 && !accounts.some(account => account.student_number === studentNumber) && <p>この生徒の確認済み登録はありません。既に登録されているご兄弟を確認し、「生徒を検索」から対象の生徒を追加してください。</p>}
        </section>}
        <div className={styles.tabs} aria-label="修正内容"><button className={styles.button} disabled={saving} aria-pressed={mode === "name"} onClick={() => setMode("name")}>名前だけ直す</button><button className={styles.button} disabled={saving} aria-pressed={mode === "register"} onClick={() => setMode("register")}>生徒・続柄・兄弟を登録する</button></div>
        {mode === "name" ? <section className={styles.panel} aria-label="LINEの名前を直す"><label>勉たんに表示する名前<input maxLength={200} value={alias} disabled={saving} onChange={event => setAlias(event.target.value)} /></label>{studentAccount && <label>変更した先生・スタッフ名<input maxLength={100} value={operator} disabled={saving} onChange={event => updateOperator(event.target.value)} /></label>}<p>勉たん内の登録名を変更します。生徒・続柄の紐付けはそのまま保持します。</p><button className={styles.button} disabled={saving || !alias.trim() || (!!studentAccount && !operator.trim())} onClick={() => void saveName()}>{saving ? "保存中…" : "この名前で保存"}</button>{message && <p role="status">{message}</p>}</section> : <LineRegistrationForm key={userId} userId={userId} displayName={contact.display_name} initialStudentNumber={studentNumber} initialStudentNumbers={accounts.length ? accounts.map(account => account.student_number) : undefined} initialRelation={value(params, "relation") === "staff" || contact.group_name === "スタッフ" ? "staff" : accounts[0]?.relation} initialRelations={Object.fromEntries(accounts.map(account => [account.student_number, account.relation]))} initialEvidenceId={value(params, "evidence")} initialAlias={contact.alias_name ?? undefined} confirmedBy={operator} onConfirmedByChange={updateOperator} onSavingChange={setSaving} source={["attendance_review", "attendance_line_review", "students_review", "contacts_review"].includes(value(params, "source")) ? value(params, "source") : "contacts_review"} onClose={goBack} onSaved={async result => { setContact(current => current ? { ...current, alias_name: result.alias } : current); await announce({ userId, ...result }); }} />}
        {saved && <button className={styles.button} disabled={saving} onClick={goBack}>保存しました。{returns[returnTo]}に戻る</button>}
        {refreshError && <p role="alert">保存は完了しました。登録情報の再読込に失敗したため、戻った後に最新状態へ更新してください。</p>}
      </>}
    </div>
  </div>;
}
