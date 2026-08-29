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
const apply = process.argv.includes("--apply");
if (!token) throw new Error("NOTION_TOKEN is not configured");

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Notion-Version": "2025-09-03",
};

function propertyText(property) {
  if (!property) return "";
  if (property.type === "title") return property.title?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "select") return property.select?.name?.trim() ?? "";
  if (property.type === "formula") {
    if (property.formula?.type === "string") return property.formula.string?.trim() ?? "";
    if (property.formula?.type === "number") return property.formula.number == null ? "" : String(property.formula.number);
  }
  return "";
}

async function notionRequest(apiPath, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${apiPath}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Notion API ${response.status}`);
  return body;
}

const candidates = [];
let cursor;
do {
  const body = await notionRequest(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 100,
      filter: { or: ["在塾", "見学中"].map((status) => ({ property: "状態", select: { equals: status } })) },
      ...(cursor ? { start_cursor: cursor } : {}),
    }),
  });
  for (const page of body.results ?? []) {
    const grade = propertyText(page.properties?.["学年"]);
    const instructionType = propertyText(page.properties?.["授業形態"]);
    if (/^高[123]$/.test(grade) && (!instructionType || instructionType === "個別")) candidates.push({ page_id: page.id, grade });
  }
  cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
} while (cursor);

if (apply) {
  for (const candidate of candidates) {
    await notionRequest(`/pages/${candidate.page_id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: { "授業形態": { select: { name: "個別ほか" } } } }),
    });
  }
}

const byGrade = candidates.reduce((counts, candidate) => {
  counts[candidate.grade] = (counts[candidate.grade] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ ok: true, apply, matched: candidates.length, updated: apply ? candidates.length : 0, by_grade: byGrade }, null, 2));
