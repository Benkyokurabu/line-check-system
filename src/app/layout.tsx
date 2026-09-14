import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "./AppFrame";
import { PwaRegistration } from "./PwaRegistration";
import { CodexPanel } from "./CodexPanel";
import {pageMetadata} from '@/lib/page-titles';

export const metadata: Metadata = {
  ...pageMetadata('勉たん'),
  description: "LINE official account message intake MVP for cram schools.",
  manifest: "/manifest.webmanifest",
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

