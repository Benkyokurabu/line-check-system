import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "教室欠席確認 - 勉たん",
    short_name: "教室欠席",
    description: "教室ごとの欠席・遅刻・早退連絡を確認する画面です。",
    start_url: "/classroom",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#06c755",
    orientation: "portrait",
    icons: [
      {
        src: "/classroom-icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/classroom-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "教室欠席確認を開く",
        short_name: "教室",
        description: "教室の欠席・遅刻・早退確認画面を開きます。",
        url: "/classroom",
        icons: [
          {
            src: "/classroom-icon.svg",
            sizes: "192x192",
            type: "image/svg+xml",
          },
        ],
      },
    ],
  };
}
