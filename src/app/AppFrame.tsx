"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { label: "授業・出欠", links: [["/attendance", "欠席連絡の確認"], ["/classroom-office", "教室への連絡"], ["/schedule-import", "授業スケジュール"]] },
  { label: "生徒・連絡", links: [["/dashboard", "未対応メッセージ"], ["/students", "生徒一覧"], ["/karte", "生徒カルテ"], ["/contacts", "連絡先管理"]] },
  { label: "予約・管理", links: [["/staff/self-study-room/trial", "自習室管理（操作確認用）"], ["/admin/notion-roster", "名簿の照合"], ["/line-alias-import", "LINE登録名の取込"], ["/feedback", "ご意見・ご要望"]] },
];

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  const studentView = pathname === "/self-study-room" || pathname.startsWith("/self-study-room/");
  const compact = studentView || pathname === "/classroom" || pathname === "/private-feedback";
  const title = navigation.flatMap((group) => group.links).find(([href]) => href === pathname)?.[1]
    ?? (studentView ? "自習室予約" : pathname === "/classroom" ? "教室の出欠確認" : pathname === "/private-feedback" ? "ご意見の確認" : "勉たん");
  return <div className={`app-frame${compact ? " app-frame-compact" : ""}`}>
    <a className="app-skip" href="#app-content">本文へ移動</a>
    {!compact && <aside className="app-sidebar">
      <Link href="/" className="app-brand" aria-label="勉たん トップページへ" prefetch={false}>勉<span>たん</span><small>BENKYO KURABU</small></Link>
      <nav aria-label="業務ナビゲーション">
        <Link href="/" className="app-home" prefetch={false}><span aria-hidden="true">⌂</span> トップページへ</Link>
        {navigation.map((group) => <div className="app-nav-group" key={group.label}><p>{group.label}</p>{group.links.map(([href, label]) => <Link href={href} key={href} prefetch={false} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</div>)}
      </nav>
      <p className="app-sidebar-footer">勉強クラブ<small>Integrated Assistant</small></p>
    </aside>}
    <div className="app-workspace">
      <header className="app-topbar">
        <span className="app-topbar-brand">勉<span>たん</span></span><span className="app-location">{title}</span>
        {!studentView && <Link href="/" className="app-topbar-home" prefetch={false}>トップページへ <span aria-hidden="true">↗</span></Link>}
      </header>
      <div id="app-content" className="app-content" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}
