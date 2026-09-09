"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./home-dashboard.module.css";

type MenuItem = { href: string; title: string; description: string };
type Group = "all" | "daily" | "student" | "data";
const groups: { id: Group; label: string; icon: string }[] = [
  { id: "all", label: "ホーム", icon: "home" },
  { id: "daily", label: "日々の連絡・自習室", icon: "calendar" },
  { id: "student", label: "生徒・連絡先", icon: "users" },
  { id: "data", label: "取り込み・照合", icon: "sync" },
];
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
function menuGroup(index: number): Group { return index < 4 ? "daily" : [4, 5, 10, 11].includes(index) ? "data" : "student"; }
function menuIcon(index: number) { return ["message", "message", "room", "calendar", "calendar", "file", "message", "users", "file", "users", "sync", "sync"][index]; }

export default function HomeDashboard({ items }: { items: MenuItem[] }) {
  const [group, setGroup] = useState<Group>("all");
  const [query, setQuery] = useState("");
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const visible = items.map((item, index) => ({ ...item, index })).filter(item =>
    (group === "all" || menuGroup(item.index) === group) &&
    (!normalized || `${item.title} ${item.description}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized)));
  const daily = visible.filter(item => item.index < 4);
  const other = visible.filter(item => item.index >= 4).sort((a, b) => {
    const order = [6, 7, 8, 9, 4, 5, 10, 11];
    return order.indexOf(a.index) - order.indexOf(b.index);
  });
  function card(item: MenuItem & { index: number }) {
    return <Link className={styles.card} href={item.href} key={item.href} prefetch={false}>
      <span className={styles.icon}><Icon name={menuIcon(item.index)} /></span>
      <div className={styles.cardText}><h3>{item.title}</h3><p>{item.description}</p></div>
      <span className={styles.arrow}><Icon name="arrow" /></span>
    </Link>;
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
      <header className={styles.topbar}><span>BENKYO KURABU</span><span className={styles.topbarAccent} aria-hidden="true" /></header>
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
        {daily.length > 0 && <section className={styles.section} aria-labelledby="daily-title"><h2 id="daily-title">日々の連絡・自習室 <small>DAILY WORK</small></h2><div className={styles.primary}>{daily.map(card)}</div></section>}
        {other.length > 0 && <section className={styles.section} aria-labelledby="tools-title"><h2 id="tools-title">{group === "data" ? "取り込み・照合" : "生徒情報・業務ツール"} <small>WORKSPACE</small></h2><div className={styles.secondary}>{other.map(card)}</div></section>}
        {visible.length === 0 && <p className={styles.empty} role="status">該当する機能はありません。別の言葉で検索してください。</p>}
      </div>
    </main>
  </div>;
}
