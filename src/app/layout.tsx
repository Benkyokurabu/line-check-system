import type { Metadata } from "next";
import "./globals.css";
import { HomeLink } from "./HomeLink";

export const metadata: Metadata = {
  title: "LINE Check System",
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

