import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const tokenFiles = [path.join(os.homedir(), ".codex", "notion_token.txt"), path.resolve("notionアクセストークン.txt")];
const tokenFile = tokenFiles.find((file) => fs.existsSync(file));
const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || (tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : "");
const dataSourceId = process.env.NOTION_STUDENT_DATA_SOURCE_ID || "19ef0120-80a7-80b7-9f23-000b21e0a53b";
if (!token) throw new Error("NOTION_TOKEN is not configured");

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Notion-Version": "2025-09-03",
};
const endpoint = `https://api.notion.com/v1/data_sources/${dataSourceId}`;
const currentResponse = await fetch(endpoint, { headers });
const current = await currentResponse.json();
if (!currentResponse.ok) throw new Error(current.message || String(currentResponse.status));

const existing = current.properties?.["授業形態"];
if (existing) {
  if (existing.type !== "select") throw new Error("Notionの「授業形態」は選択プロパティではありません。安全のため変更を中止しました。");
  console.log(JSON.stringify({ ok: true, changed: false, property: "授業形態", type: existing.type }, null, 2));
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    properties: {
      "授業形態": {
        select: {
          options: [
            { name: "集団", color: "blue" },
            { name: "個別", color: "orange" },
            { name: "併用", color: "green" },
          ],
        },
      },
    },
  }),
});
const body = await response.json();
if (!response.ok) throw new Error(body.message || String(response.status));
const property = body.properties?.["授業形態"];
if (property?.type !== "select") throw new Error("Notionの授業形態プロパティを確認できませんでした");
console.log(JSON.stringify({ ok: true, changed: true, property: "授業形態", type: property.type }, null, 2));
