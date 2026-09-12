"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./home-dashboard.module.css";

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
const SURVEY_CONFIRMED_KEY = "bentan:2026-autumn-survey-confirmed";
const SURVEY_HIDDEN_KEY = "bentan:2026-autumn-survey-hidden";
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
  const [confirmedSurveys, setConfirmedSurveys] = useState<string[]>([]);
  const [hiddenSurveys, setHiddenSurveys] = useState<string[]>([]);
  const [showHiddenSurveys, setShowHiddenSurveys] = useState(false);
  const [surveyRefreshing, setSurveyRefreshing] = useState(false);
  const [surveyRefreshMessage, setSurveyRefreshMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      const savedConfirmed = JSON.parse(window.localStorage.getItem(SURVEY_CONFIRMED_KEY) ?? "[]");
      const savedHidden = JSON.parse(window.localStorage.getItem(SURVEY_HIDDEN_KEY) ?? "[]");
      if (Array.isArray(savedConfirmed) && savedConfirmed.every(item => typeof item === "string")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConfirmedSurveys(savedConfirmed);
      }
      if (Array.isArray(savedHidden) && savedHidden.every(item => typeof item === "string")) {
        setHiddenSurveys(savedHidden);
      }
    } catch { /* Ignore invalid browser data and start with every item unconfirmed. */ }
  }, []);
  function toggleSurveyConfirmation(notionUrl: string) {
    setConfirmedSurveys(current => {
      const next = current.includes(notionUrl) ? current.filter(item => item !== notionUrl) : [...current, notionUrl];
      window.localStorage.setItem(SURVEY_CONFIRMED_KEY, JSON.stringify(next));
      return next;
    });
  }
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
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.groups)) throw new Error();
      setSurveyGroups(body.groups);
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
                <div className={styles.teacherButtons} aria-label="担任を選択">
                  {visibleSurveyGroups.map(item => <button key={item.teacher} type="button" aria-pressed={!showHiddenSurveys && selectedSurveyTeacher === item.teacher} onClick={() => { setShowHiddenSurveys(false); setSelectedSurveyTeacher(current => current === item.teacher ? null : item.teacher); }}>
                    {item.teacher}先生 <span>{item.students.length}</span>
                  </button>)}
                  {hiddenSurveyRows.length > 0 && <button className={styles.surveyHiddenListButton} type="button" aria-pressed={showHiddenSurveys} onClick={() => { setSelectedSurveyTeacher(null); setShowHiddenSurveys(current => !current); }}>非表示一覧 <span>{hiddenSurveyRows.length}</span></button>}
                  <button className={styles.surveyRefreshButton} type="button" disabled={surveyRefreshing} onClick={refreshSurveys}>{surveyRefreshing ? "更新中…" : "更新する"}</button>
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
                </div> : selectedSurveyTeacher ? <div className={styles.surveyStudents}>
                  <div className={styles.surveyListTitle}><strong>{selectedSurveyTeacher}先生の担当</strong><span>{visibleSurveyGroups.find(item => item.teacher === selectedSurveyTeacher)?.students.length ?? 0}名</span><button type="button" onClick={() => setSelectedSurveyTeacher(null)}>閉じる</button></div>
                  <ul aria-label={`${selectedSurveyTeacher}先生のアンケート回答`}>
                    {(visibleSurveyGroups.find(item => item.teacher === selectedSurveyTeacher)?.students ?? []).map(student => {
                      const confirmed = confirmedSurveys.includes(student.notionUrl);
                      return <li key={`${student.grade}-${student.name}-${student.notionUrl}`}>
                        <span className={styles.gradeBadge}>{student.grade}</span>
                        <a href={student.notionUrl} target="_blank" rel="noreferrer">{student.name}<small>{formatSubmittedAt(student.submittedAt)}</small><small>Notionで見る ↗</small></a>
                        <div className={styles.surveyActions}>
                          <button className={styles.surveyStatusButton} type="button" aria-pressed={confirmed} onClick={() => toggleSurveyConfirmation(student.notionUrl)}>{confirmed ? "確認済み" : "未確認"}</button>
                          <button className={styles.surveyHideButton} type="button" onClick={() => hideSurvey(student.notionUrl)}>確認したのでこの行を削除する</button>
                        </div>
                      </li>;
                    })}
                  </ul>
                  <p className={styles.surveyNote}>確認・非表示の状態はこの端末のブラウザだけに保存されます。Notionのデータは削除・更新されず、ほかの端末にも反映されません。</p>
                </div> : <p className={styles.surveyPrompt}>先生を選ぶと、アンケートが届いている担当生徒を表示します。</p>}
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
