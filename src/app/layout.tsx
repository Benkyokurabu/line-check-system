import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "./AppFrame";
import { PwaRegistration } from "./PwaRegistration";
import { CodexPanel } from "./CodexPanel";

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
      { url: "/bentan-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/bentan-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/classroom-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/classroom-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#12263e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body><PwaRegistration /><AppFrame>{children}</AppFrame><CodexPanel /></body>
    </html>
  );
}

