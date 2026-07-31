import type { Metadata, Viewport } from "next";
import "./globals.css";
import { HomeLink } from "./HomeLink";
import { PwaRegistration } from "./PwaRegistration";

export const metadata: Metadata = {
  title: "勉たん（仮） -勉強クラブ総合アシスたんトさん-",
  description: "LINE official account message intake MVP for cram schools.",
  applicationName: "遅刻・欠席確認",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "遅刻・欠席確認",
  },
  icons: {
    icon: [
      { url: "/classroom-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/classroom-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/classroom-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/classroom-icon-512.png", sizes: "512x512", type: "image/png" },
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
      <body><PwaRegistration /><HomeLink />{children}</body>
    </html>
  );
}

