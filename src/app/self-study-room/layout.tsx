import type { Metadata } from "next";
import {pageMetadata} from '@/lib/page-titles';

export const metadata: Metadata = {
  ...pageMetadata('自習室予約'),
  description: "勉強クラブの自習室予約。時間帯と座席の空き状況、申請・予約状況を確認できます。",
};

export default function SelfStudyRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
