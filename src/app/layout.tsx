import type { Metadata, Viewport } from "next";
import "./globals.css";
import { HomeLink } from "./HomeLink";

export const metadata: Metadata = {
  title: "勉たん（仮） -勉強クラブ総合アシスたんトさん-",
  description: "LINE official account message intake MVP for cram schools.",
  applicationName: "教室欠席確認",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "教室欠席確認",
  },
  icons: {
    icon: [
      { url: "/classroom-icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/classroom-icon.svg", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#06c755",
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

