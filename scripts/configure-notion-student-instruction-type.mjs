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
const removeLegacy = process.argv.includes("--remove-legacy");
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
if (existing && existing.type !== "select") throw new Error("Notionの「授業形態」は選択プロパティではありません。安全のため変更を中止しました。");

const desiredOptions = [
  { name: "集団", color: "blue" },
  { name: "個別ほか", color: "orange" },
  { name: "併用", color: "green" },
];
const currentOptions = existing?.select?.options ?? [];
const normalizedOptions = currentOptions
  .filter((option) => !removeLegacy || option.name !== "個別");
for (const desired of desiredOptions) {
  if (!normalizedOptions.some((option) => option.name === desired.name)) normalizedOptions.push(desired);
}
const beforeNames = currentOptions.map((option) => option.name);
const afterNames = normalizedOptions.map((option) => option.name);
const changed = !existing || JSON.stringify(beforeNames) !== JSON.stringify(afterNames);
if (!changed) {
  console.log(JSON.stringify({ ok: true, changed: false, remove_legacy: removeLegacy, property: "授業形態", type: existing.type, options: afterNames }, null, 2));
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    properties: {
      "授業形態": {
        select: {
          options: normalizedOptions,
        },
      },
    },
  }),
});
const body = await response.json();
if (!response.ok) throw new Error(body.message || String(response.status));
const property = body.properties?.["授業形態"];
if (property?.type !== "select") throw new Error("Notionの授業形態プロパティを確認できませんでした");
console.log(JSON.stringify({ ok: true, changed: true, remove_legacy: removeLegacy, property: "授業形態", type: property.type, options: property.select?.options?.map((option) => option.name) ?? [] }, null, 2));
