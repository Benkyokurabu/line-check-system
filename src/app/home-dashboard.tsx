"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./home-dashboard.module.css";

type Group = "all" | "student" | "lesson" | "communication" | "reservation" | "admin";
type MenuItem = { href: string; title: string; description: string; group: Exclude<Group, "all">; icon: string; trial?: boolean };
const groups: { id: Group; label: string; icon: string }[] = [
  { id: "all", label: "ホーム", icon: "home" },
  { id: "student", label: "生徒", icon: "users" },
  { id: "lesson", label: "授業・出欠", icon: "calendar" },
  { id: "communication", label: "連絡", icon: "message" },
  { id: "reservation", label: "予約", icon: "room" },
  { id: "admin", label: "設定・管理", icon: "sync" },
];
const favoritesKey = "bentan:home:favorites:v1";
const defaultFavorites = ["/attendance", "/dashboard", "/students", "/karte"];
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
export default function HomeDashboard({ items }: { items: MenuItem[] }) {
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(defaultFavorites);
  const [ready, setReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(favoritesKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every(value => typeof value === "string")) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFavorites([...new Set(parsed)].filter(href => items.some(item => item.href === href)));
        }
      }
    } catch { setStorageNotice("保存設定を読み込めません。この画面内で変更できます。"); }
    setReady(true);
  }, [items]);
  function saveFavorites(next: string[]) {
    setFavorites(next);
    try { localStorage.setItem(favoritesKey, JSON.stringify(next)); setStorageNotice(""); }
    catch { setStorageNotice("設定を保存できませんでした。この画面内だけに反映しています。"); }
  }
  function toggleFavorite(href: string) {
    saveFavorites(favorites.includes(href) ? favorites.filter(value => value !== href) : [...favorites, href]);
  }
  function moveFavorite(index: number, direction: number) {
    const next = [...favorites];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    saveFavorites(next);
  }
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const visible = items.filter(item => (group === "all" || item.group === group) &&
    (!normalized || `${item.title} ${item.description}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized)));
  const home = group === "all" && !normalized;
  function card(item: MenuItem, favoriteIndex?: number) {
    const pinned = favorites.includes(item.href);
    return <div className={styles.cardShell} key={item.href}>
      <Link className={styles.card} href={item.href} prefetch={false}>
        <span className={styles.icon}><Icon name={item.icon} /></span>
        <div className={styles.cardText}>{item.trial && <span className={styles.badge}>操作確認用</span>}<h3>{item.title}</h3><p>{item.description}</p></div>
        <span className={styles.arrow}><Icon name="arrow" /></span>
      </Link>
      <div className={styles.cardActions}>
        <button type="button" disabled={!ready} aria-label={`${item.title}を${pinned ? "固定解除" : "固定"}`} aria-pressed={pinned} onClick={() => toggleFavorite(item.href)}>{pinned ? "★ 固定済み" : "☆ 固定する"}</button>
        {favoriteIndex !== undefined && <span>
          <button type="button" disabled={!ready || favoriteIndex === 0} aria-label={`${item.title}を前へ`} onClick={() => moveFavorite(favoriteIndex, -1)}>←</button>
          <button type="button" disabled={!ready || favoriteIndex === favorites.length - 1} aria-label={`${item.title}を後へ`} onClick={() => moveFavorite(favoriteIndex, 1)}>→</button>
        </span>}
      </div>
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
            <div className={styles.quickLinks}>
              <Link href="/attendance" prefetch={false}><Icon name="calendar" /><span>欠席連絡を確認する</span><span>→</span></Link>
              <Link href="/dashboard" prefetch={false}><Icon name="message" /><span>未対応メッセージを確認する</span><span>→</span></Link>
              <Link href="/classroom-office" prefetch={false}><Icon name="message" /><span>教室との連絡を確認する</span><span>→</span></Link>
            </div>
          </section>
          <section className={styles.section} aria-labelledby="favorites-title">
            <h2 id="favorites-title">よく使う業務</h2>
            <p className={styles.sectionNote}>各業務の「固定する」で追加できます。並び順はこのブラウザに保存され、同じブラウザを使う人と共有されます。</p>
            {storageNotice && <p role="status" className={styles.sectionNote}>{storageNotice}</p>}
            <div className={styles.primary}>{favorites.map((href, index) => { const item = items.find(item => item.href === href); return item ? card(item, index) : null; })}</div>
            {favorites.length === 0 && <p className={styles.empty}>下の業務一覧から、よく使う業務を固定してください。</p>}
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
