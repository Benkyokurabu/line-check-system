import type { Metadata } from "next";
import {pageMetadata} from '@/lib/page-titles';

export const metadata: Metadata = {
  ...pageMetadata('遅刻・欠席確認'),
};

export default function AttendanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
