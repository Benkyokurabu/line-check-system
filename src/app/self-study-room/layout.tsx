import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "勉強クラブ 自習室予約",
  description: "勉強クラブの自習室予約。時間帯と座席の空き状況、申請・予約状況を確認できます。",
  applicationName: "勉強クラブ 自習室予約",
  appleWebApp: { capable: true, title: "勉強クラブ 自習室予約" },
};

export default function SelfStudyRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
