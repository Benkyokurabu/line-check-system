"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./home-dashboard.module.css";
import {useSurveyConfirmations} from './use-survey-shared';
import {surveyPageId} from '@/lib/survey-confirmations.mjs';

type Group = "all" | "student" | "lesson" | "communication" | "reservation" | "admin";
type MenuItem = { href: string; title: string; description: string; group: Exclude<Group, "all">; icon: string; trial?: boolean };
type InterviewSurveyTeacherGroup = { teacher: string; students: Array<{ grade: string; name: string; notionUrl: string; submittedAt: string }> };
const groups: { id: Group; label: string; icon: string }[] = [
  { id: "all", label: "ホーム", icon: "home" },
  { id: "student", label: "生徒", icon: "users" },
  { id: "lesson", label: "授業・出欠", icon: "calendar" },
  { id: "communication", label: "連絡", icon: "message" },
  { id: "reservation", label: "予約", icon: "room" },
  { id: "admin", label: "設定・管理", icon: "sync" },
];
const frequentLinks = ["/attendance", "/dashboard", "/students", "/karte"];
const SURVEY_HIDDEN_KEY = "bentan:2026-autumn-survey-hidden";
const SURVEY_DATA_KEY = "bentan:2026-autumn-survey-data";
function isSurveyGroups(value: unknown): value is InterviewSurveyTeacherGroup[] {
  return Array.isArray(value) && value.every(group =>
    typeof group === "object" && group !== null &&
    "teacher" in group && typeof group.teacher === "string" &&
    "students" in group && Array.isArray(group.students) && group.students.every((student: unknown) =>
      typeof student === "object" && student !== null &&
      "grade" in student && typeof student.grade === "string" &&
      "name" in student && typeof student.name === "string" &&
      "notionUrl" in student && typeof student.notionUrl === "string" &&
      "submittedAt" in student && typeof student.submittedAt === "string"));
}
const submittedAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});
function formatSubmittedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "提出日時不明" : `提出 ${submittedAtFormatter.format(date)}`;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h5v-7h4v7h5V9" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M7 15h3M14 15h3" /></>,
    message: <><path d="M4 4h16v12H9l-5 4z" /><path d="M8 8h8M8 12h5" /></>,
    room: <><path d="M4 20h16M6 20V4h12v16M9 8h6M9 12h6M9 16h6" /></>,
    users: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a4 4 0 0 1 3 4v2" /></>,
    file: <><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5" /></>,
    sync: <><path d="M4 9a8 8 0 0 1 14-3l3 3M21 3v6h-6M20 15a8 8 0 0 1-14 3l-3-3M3 21v-6h6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    arrow: <><path d="M6 18 18 6M6 6h12v12" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.file}</svg>;
}
export default function HomeDashboard({
  items,
  surveyGroups: initialSurveyGroups,
  surveyError,
}: {
  items: MenuItem[];
  surveyGroups: InterviewSurveyTeacherGroup[];
  surveyError?: string;
}) {
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [selectedSurveyTeacher, setSelectedSurveyTeacher] = useState<string | null>(null);
  const [surveyGroups, setSurveyGroups] = useState(initialSurveyGroups);
  const confirmation = useSurveyConfirmations();
  const [hiddenSurveys, setHiddenSurveys] = useState<string[]>([]);
  const [showHiddenSurveys, setShowHiddenSurveys] = useState(false);
  const [surveyRefreshing, setSurveyRefreshing] = useState(false);
  const [surveyRefreshMessage, setSurveyRefreshMessage] = useState<string | null>(null);
  const [surveyQuery, setSurveyQuery] = useState("");
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  useEffect(() => {
    try {
      const savedHidden = JSON.parse(window.localStorage.getItem(SURVEY_HIDDEN_KEY) ?? "[]");
      const savedSurveyGroups = JSON.parse(window.localStorage.getItem(SURVEY_DATA_KEY) ?? "null");
      if (Array.isArray(savedHidden) && savedHidden.every(item => typeof item === "string")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHiddenSurveys(savedHidden);
      }
      if (isSurveyGroups(savedSurveyGroups)) {
        setSurveyGroups(savedSurveyGroups);
      }
    } catch { /* Ignore invalid browser data and start with every item unconfirmed. */ }
    // Cached answers are a fallback, never the permanent source of teacher names.
    void refreshSurveys();
  }, []);
  function hideSurvey(notionUrl: string) {
    setHiddenSurveys(current => {
      if (current.includes(notionUrl)) return current;
      const next = [...current, notionUrl];
      window.localStorage.setItem(SURVEY_HIDDEN_KEY, JSON.stringify(next));
      return next;
    });
  }
  function restoreSurvey(notionUrl: string) {
    const next = hiddenSurveys.filter(item => item !== notionUrl);
    setHiddenSurveys(next);
    window.localStorage.setItem(SURVEY_HIDDEN_KEY, JSON.stringify(next));
    if (next.length === 0) setShowHiddenSurveys(false);
  }
  function restoreAllSurveys() {
    setHiddenSurveys([]);
    window.localStorage.setItem(SURVEY_HIDDEN_KEY, "[]");
    setShowHiddenSurveys(false);
  }
  async function refreshSurveys() {
    setSurveyRefreshing(true);
    setSurveyRefreshMessage(null);
    try {
      const response = await fetch("/api/interview-surveys", { cache: "no-store" });
      const body: unknown = await response.json();
      const refreshedGroups = typeof body === "object" && body !== null && "groups" in body ? body.groups : null;
      if (!response.ok || !isSurveyGroups(refreshedGroups)) throw new Error();
      setSurveyGroups(refreshedGroups);
      window.localStorage.setItem(SURVEY_DATA_KEY, JSON.stringify(refreshedGroups));
      setSurveyRefreshMessage("Notionから最新の回答を更新しました。");
    } catch {
      setSurveyRefreshMessage("Notionから更新できませんでした。連携権限を確認してください。");
    } finally {
      setSurveyRefreshing(false);
    }
  }
  const visibleSurveyGroups = surveyGroups.map(item => ({
    ...item,
    students: item.students
      .filter(student => !hiddenSurveys.includes(student.notionUrl))
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt) || left.name.localeCompare(right.name, "ja")),
  }));
  const hiddenSurveyRows = surveyGroups.flatMap(item => item.students
    .filter(student => hiddenSurveys.includes(student.notionUrl))
    .map(student => ({ ...student, teacher: item.teacher })))
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt) || left.name.localeCompare(right.name, "ja"));
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const surveyName = surveyQuery.normalize("NFKC").replace(/\s/g, "");
  const surveyRows = visibleSurveyGroups.filter(item => !selectedSurveyTeacher || item.teacher === selectedSurveyTeacher)
    .flatMap(item => item.students.map(student => ({ ...student, teacher: item.teacher })))
    .filter(student => (!surveyName || student.name.normalize("NFKC").replace(/\s/g, "").includes(surveyName)) && (!onlyUnconfirmed || !confirmation.isConfirmed(student.notionUrl)))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const visible = items.filter(item => (group === "all" || item.group === group) &&
    (!normalized || `${item.title} ${item.description}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized)));
  const home = group === "all" && !normalized;
  function card(item: MenuItem) {
    return <div className={styles.cardShell} key={item.href}>
      <Link className={styles.card} href={item.href} prefetch={false}>
        <span className={styles.icon}><Icon name={item.icon} /></span>
        <div className={styles.cardText}>{item.trial && <span className={styles.badge}>操作確認用</span>}<h3>{item.title}</h3><p>{item.description}</p></div>
        <span className={styles.arrow}><Icon name="arrow" /></span>
      </Link>
    </div>;
  }
  return <div className={styles.dashboard}>
    <a className={styles.skip} href="#home-menu">メニューへ移動</a>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>勉<span>たん</span></span><small>BENKYO KURABU</small></div>
      <nav className={styles.navigation} aria-label="機能の分類">
        {groups.map(item => <button key={item.id} type="button" aria-pressed={group === item.id} className={group === item.id ? styles.active : ""} onClick={() => { setGroup(item.id); setQuery(""); }}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>)}
      </nav>
      <p className={styles.sidebarFooter}>勉強クラブ<br /><span>Integrated Assistant</span></p>
    </aside>
    <main className={styles.main}>
      <header className={styles.topbar}><span>BENKYO KURABU</span><Link href="/karte" prefetch={false}>生徒を探す →</Link></header>
      <div className={styles.content}>
        <section className={styles.hero} aria-label="勉たん">
          <div><p className={styles.eyebrow}>INTEGRATED ASSISTANT</p><h1>勉<span>たん</span></h1>
            <p className={styles.tagline}><strong>勉</strong>強クラブ総合アシス<strong>たん</strong>トさん</p>
          </div><div className={styles.monogram} aria-hidden="true"><span>勉</span></div>
        </section>
        <div className={styles.menuToolbar} id="home-menu" tabIndex={-1}>
          <span className={styles.currentGroup}>{groups.find(item => item.id === group)?.label === "ホーム" ? "業務メニュー" : groups.find(item => item.id === group)?.label}</span>
          <label className={styles.search}><Icon name="search" /><input type="search" aria-label="機能を探す" placeholder="機能を探す" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" aria-label="検索をクリア" onClick={() => setQuery("")}>×</button>}
          </label>
        </div>
        {home && <>
          <section className={styles.section} aria-labelledby="check-title">
            <h2 id="check-title">連絡・確認</h2>
            <div className={styles.surveyPanel}>
              <div className={styles.surveyHeading}>
                <div><p className={styles.surveyEyebrow}>2026年 秋のアンケート</p><h3>担当生徒の回答を確認してください</h3></div>
                {!surveyError && <span className={styles.surveyTotal}>表示中 {visibleSurveyGroups.reduce((sum, item) => sum + item.students.length, 0)}件</span>}
              </div>
              {surveyError ? <p className={styles.surveyError} role="status">{surveyError}</p> : <>
                <div className={styles.surveyTools}>
                  <label className={styles.surveySearch}><Icon name="search" /><input type="search" aria-label="アンケートの生徒を検索" placeholder="生徒名で探す" value={surveyQuery} onChange={e=>{setSurveyQuery(e.target.value);setShowHiddenSurveys(false);}} /></label>
                  <button type="button" aria-pressed={onlyUnconfirmed} onClick={()=>{setOnlyUnconfirmed(v=>!v);setShowHiddenSurveys(false);}}>未確認だけ</button>
                  <button type="button" disabled={surveyRefreshing} onClick={refreshSurveys}>{surveyRefreshing ? "更新中…" : "更新する"}</button>
                  <button type="button" disabled={!!confirmation.saving} onClick={()=>void confirmation.load()}>確認状態を再取得</button>
                </div>
                <p className={styles.surveyRefreshMessage} role="status">{confirmation.message || (confirmation.ready ? '確認状態は自動保存され、先生間で共有されます。' : '共有の確認状態を読み込み中…')}{confirmation.lastSync&&` 最終同期 ${confirmation.lastSync}`}{confirmation.loginNeeded&&<> <Link className={styles.surveySave} href="/staff/self-study-room">職員ログイン</Link></>}</p>
                {Object.keys(confirmation.local).length>0&&<div className={styles.surveyStudents} aria-label="未共有の端末記録">
                  <strong>未共有の端末記録 {Object.keys(confirmation.local).length}件</strong>
                  <p>共有状態は下の一覧に表示しています。端末内の記録を反映する場合は、対象と内容を確認して共有してください。</p>
                  <ul>{Object.entries(confirmation.local).map(([id,record])=>{
                    const student=surveyGroups.flatMap(g=>g.students).find(s=>surveyPageId(s.notionUrl)===id);
                    const current=confirmation.get(`https://app.notion.com/p/${id}`);
                    return <li key={id}><div><strong>{student?.name??'現在の回答一覧にない記録'}</strong><p>端末の操作：{record.confirmed?'確認済み':'未確認'} ／ 共有：{confirmation.ready?(current?.confirmed?'確認済み':'未確認'):'取得待ち'}</p>{confirmation.issues[id]&&<p role="alert">{confirmation.issues[id]}</p>}
                    <div className={styles.surveyActions}><button className={styles.surveyStatusButton} disabled={!student||!confirmation.ready||!!confirmation.saving} onClick={()=>confirmation.retry(id)}>{confirmation.saving===id?'保存中…':confirmation.issues[id]?'内容を確認して再試行':'この端末の記録を共有'}</button><button className={styles.surveyRestoreButton} disabled={!!confirmation.saving} onClick={()=>confirmation.discard(id)}>共有状態を使う</button></div></div></li>;
                  })}</ul>
                </div>}
                <div className={styles.teacherButtons} aria-label="担任を選択">
                  {visibleSurveyGroups.map(item => <button key={item.teacher} type="button" aria-pressed={!showHiddenSurveys && selectedSurveyTeacher === item.teacher} onClick={() => { setShowHiddenSurveys(false); setSelectedSurveyTeacher(current => current === item.teacher ? null : item.teacher); }}>
                    {item.teacher === '担任未特定' ? '担任を確認' : `${item.teacher}先生`} <span>{item.students.length}</span>
                  </button>)}
                  {hiddenSurveyRows.length > 0 && <button className={styles.surveyHiddenListButton} type="button" aria-pressed={showHiddenSurveys} onClick={() => { setSelectedSurveyTeacher(null); setShowHiddenSurveys(current => !current); }}>非表示一覧 <span>{hiddenSurveyRows.length}</span></button>}
                </div>
                {surveyRefreshMessage && <p className={styles.surveyRefreshMessage} role="status">{surveyRefreshMessage}</p>}
                {showHiddenSurveys ? <div className={styles.surveyStudents}>
                  <div className={styles.surveyListTitle}><strong>非表示にした回答</strong><span>{hiddenSurveyRows.length}名</span><button type="button" onClick={restoreAllSurveys}>すべて戻す</button><button type="button" onClick={() => setShowHiddenSurveys(false)}>閉じる</button></div>
                  <ul aria-label="非表示にしたアンケート回答">
                    {hiddenSurveyRows.map(student => <li key={`${student.grade}-${student.name}-${student.notionUrl}`}>
                      <span className={styles.gradeBadge}>{student.grade}</span>
                      <a href={student.notionUrl} target="_blank" rel="noreferrer">{student.name}<small>{student.teacher}先生・{formatSubmittedAt(student.submittedAt)}</small><small>Notionで見る ↗</small></a>
                      <div className={styles.surveyActions}><button className={styles.surveyRestoreButton} type="button" onClick={() => restoreSurvey(student.notionUrl)}>この行を戻す</button></div>
                    </li>)}
                  </ul>
                </div> : (selectedSurveyTeacher || surveyQuery || onlyUnconfirmed) ? <div className={styles.surveyStudents}>
                  <div className={styles.surveyListTitle}><strong>{selectedSurveyTeacher ? (selectedSurveyTeacher==='担任未特定' ? '担任の確認が必要な回答' : `${selectedSurveyTeacher}先生の担当`) : '検索・絞り込みの結果'}</strong><span>{surveyRows.length}件</span><button type="button" onClick={() => {setSelectedSurveyTeacher(null);setSurveyQuery('');setOnlyUnconfirmed(false);}}>閉じる</button></div>
                  {surveyRows.length===0 && <p className={styles.surveyPrompt}>条件に合う回答はありません。</p>}
                  <ul aria-label={selectedSurveyTeacher ? `${selectedSurveyTeacher}先生のアンケート回答` : '検索したアンケート回答'}>
                    {surveyRows.map(student => {
                      const confirmed = confirmation.isConfirmed(student.notionUrl);
                      return <li key={`${student.grade}-${student.name}-${student.notionUrl}`}>
                        <span className={styles.gradeBadge}>{student.grade}</span>
                        <a href={student.notionUrl} target="_blank" rel="noreferrer">{student.name}<small>{!selectedSurveyTeacher && `${student.teacher}先生・`}{formatSubmittedAt(student.submittedAt)}</small><small>回答を開く ↗</small></a>
                        <div className={styles.surveyActions}>
                          <button className={styles.surveyStatusButton} type="button" disabled={!confirmation.ready||!!confirmation.saving} aria-pressed={confirmed} onClick={() => confirmation.toggle(student.notionUrl)}>{confirmation.saving===surveyPageId(student.notionUrl)?'保存中…':!confirmation.ready?'確認状態を取得待ち':confirmed ? "確認済み" : "未確認"}</button>
                          {confirmation.get(student.notionUrl)?.updated_at&&<small>最終更新：{confirmation.get(student.notionUrl)?.updated_name} {submittedAtFormatter.format(new Date(confirmation.get(student.notionUrl)!.updated_at!))}</small>}
                          <button className={styles.surveyHideButton} type="button" aria-label="確認したのでこの行を削除する" title="この端末の一覧から非表示にします" onClick={() => hideSurvey(student.notionUrl)}>非表示</button>
                        </div>
                      </li>;
                    })}
                  </ul>
                  <p className={styles.surveyNote}>確認状態はボタンを押すと自動保存します。他のPCは画面を開いた時・戻った時・表示中の30秒ごとに同期します。「非表示」はこの端末だけに反映されます。</p>
                </div> : <p className={styles.surveyPrompt}>先生を選ぶか、生徒名で検索してください。</p>}
              </>}
            </div>
            <div className={styles.quickLinks}>
              <Link href="/attendance" prefetch={false}><Icon name="calendar" /><span>欠席連絡を確認する</span><span>→</span></Link>
              <Link href="/dashboard" prefetch={false}><Icon name="message" /><span>未対応メッセージを確認する</span><span>→</span></Link>
              <Link href="/classroom-office" prefetch={false}><Icon name="message" /><span>教室との連絡を確認する</span><span>→</span></Link>
            </div>
          </section>
          <section className={styles.section} aria-labelledby="favorites-title">
            <h2 id="favorites-title">よく使う業務</h2>
            <div className={styles.primary}>{frequentLinks.map(href => { const item = items.find(item => item.href === href); return item ? card(item) : null; })}</div>
          </section>
        </>}
        {groups.filter(category => category.id !== "all").map(category => {
          const categoryItems = visible.filter(item => item.group === category.id);
          return categoryItems.length > 0 && <section className={styles.section} aria-labelledby={`group-${category.id}`} key={category.id}>
            <h2 id={`group-${category.id}`}>{category.label}{category.id === "reservation" && <small>操作確認用</small>}</h2>
            <div className={styles.secondary}>{categoryItems.map(item => card(item))}</div>
          </section>;
        })}
        {visible.length === 0 && <p className={styles.empty} role="status">該当する機能はありません。別の言葉で検索してください。</p>}
      </div>
    </main>
  </div>;
}
