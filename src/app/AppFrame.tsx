"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {pageTitles} from '@/lib/page-titles';

const navigation = [
  { id: "daily", label: "【事務】日常業務", links: [["/attendance", "欠席連絡の確認"], ["/classroom-office", "教室への連絡"]] },
  { id: "interview", label: "面談・予約関連", links: [["/staff/surveys", "アンケートを確認する"], ["/staff/interview-materials", "面談資料を作る"], ["/staff/interview-availability", "予約可能枠を作る"], ["/staff/interview-availability/manual", "予約可能枠をコピー"]] },
  { id: "management", label: "授業・管理", links: [["/staff/recordings", "録画の公開設定"], ["/schedule-import", "授業スケジュール取込"], ["/contacts", "連絡先管理"], ["/contacts#roster-import", "クラス一覧表の取り込み"], ["/admin/notion-roster", "Notion・クラス一覧 照合"], ["/line-alias-import", "LINE登録名の取り込み"], ["/feedback", "改善してほしいことなど、何でも"]] },
  { id: "prelaunch", label: "本番運用前", links: [["/dashboard", "未対応メッセージ"], ["/students", "担任・クラス別 生徒一覧"], ["/karte", "生徒カルテ"], ["/staff/self-study-room/trial", "自習室管理"], ["/self-study-room/trial", "自習室予約"]] },
];

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/" || pathname === '/staff/entry' || pathname.startsWith("/interviews")) return children;
  const reservationMenu = pathname.startsWith("/reservations/trial");
  const studentView = reservationMenu || pathname === "/self-study-room" || pathname.startsWith("/self-study-room/");
  const compact = studentView || pathname === "/classroom" || pathname === "/private-feedback";
  const title = pageTitles[pathname] ?? navigation.flatMap((group) => group.links).find(([href]) => href === pathname)?.[1]
    ?? (studentView ? "自習室予約" : pathname === "/classroom" ? "教室の出欠確認" : pathname === "/private-feedback" ? "ご意見の確認" : "勉たん");
  return <div className={`app-frame${compact ? " app-frame-compact" : ""}`}>
    <a className="app-skip" href="#app-content">本文へ移動</a>
    {!compact && <aside className="app-sidebar">
      <Link href="/" className="app-brand" aria-label="勉たん トップページへ" prefetch={false}>勉<span>たん</span><small>BENKYO KURABU</small></Link>
      <nav aria-label="業務ナビゲーション">
        <Link href="/" className="app-home" prefetch={false}><span aria-hidden="true">⌂</span> トップページへ</Link>
        {navigation.map((group) => <div className="app-nav-group" key={group.id}><p><a href={`/#group-${group.id}`}>{group.label}</a></p>{group.links.map(([href, label]) => <Link href={href} key={href} prefetch={false} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</div>)}
      </nav>
      <p className="app-sidebar-footer">勉強クラブ<small>Integrated Assistant</small></p>
    </aside>}
    <div className="app-workspace">
      {!reservationMenu&&<header className="app-topbar">
        {studentView
          ? <span>{title}</span>
          : pathname === "/classroom"
            ? <span>{title}</span>
            : <><span className="app-topbar-brand">勉<span>たん</span></span><span className="app-location">{title}</span></>}
        {!studentView && pathname!=="/classroom" && <Link href="/" className="app-topbar-home" prefetch={false}>トップページへ <span aria-hidden="true">↗</span></Link>}
      </header>}
      <div id="app-content" className="app-content" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}
