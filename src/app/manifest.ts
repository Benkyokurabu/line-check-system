import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "遅刻・欠席確認",
    short_name: "遅刻・欠席",
    description: "教室ごとの欠席・遅刻・早退連絡を確認する画面です。",
    start_url: "/classroom",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#06c755",
    orientation: "portrait",
    icons: [
      {
        src: "/classroom-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/classroom-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/classroom-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "遅刻・欠席確認を開く",
        short_name: "教室",
        description: "教室の欠席・遅刻・早退確認画面を開きます。",
        url: "/classroom",
        icons: [
          {
            src: "/classroom-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
