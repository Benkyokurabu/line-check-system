import type { Metadata } from "next";
import "./globals.css";
import { HomeLink } from "./HomeLink";

export const metadata: Metadata = {
  title: "勉たん -勉強クラブ総合アシスたんトさん-",
  description: "LINE official account message intake MVP for cram schools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body><HomeLink />{children}</body>
    </html>
  );
}

