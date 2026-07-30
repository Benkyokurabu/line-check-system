import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "遅刻・欠席確認",
};

export default function AttendanceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
