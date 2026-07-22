import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tokenPaths = [path.join(os.homedir(), ".codex", "notion_token.txt"), path.resolve("notionアクセストークン.txt")];
const tokenPath = tokenPaths.find((candidate) => fs.existsSync(candidate));
const notionToken = process.env.NOTION_TOKEN || (tokenPath ? fs.readFileSync(tokenPath, "utf8").trim() : "");
const studentDataSourceId = process.env.NOTION_STUDENT_DATA_SOURCE_ID || "19ef0120-80a7-80b7-9f23-000b21e0a53b";
if (!notionToken) throw new Error("Notion token is not available");

async function notion(endpoint, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...init,
    headers: { Authorization: `Bearer ${notionToken}`, "Content-Type": "application/json", "Notion-Version": "2025-09-03", ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message || "request failed"}`);
  return body;
}

const studentSource = await notion(`/data_sources/${studentDataSourceId}`);
const studentDatabaseId = studentSource.parent?.database_id;
if (!studentDatabaseId) throw new Error("Student data source parent database was not found");
const studentDatabase = await notion(`/databases/${studentDatabaseId}`);
const parentPageId = process.env.NOTION_ATTENDANCE_PARENT_PAGE_ID || studentDatabase.parent?.page_id;
if (!parentPageId) throw new Error("Set NOTION_ATTENDANCE_PARENT_PAGE_ID to a shared Notion page");

const search = await notion("/search", { method: "POST", body: JSON.stringify({ query: "欠席連絡管理", filter: { property: "object", value: "data_source" }, page_size: 20 }) });
const existing = search.results?.find((item) => item.title?.map((part) => part.plain_text).join("") === "欠席連絡管理");
if (existing) {
  console.log(JSON.stringify({ ok: true, created: false, data_source_id: existing.id }, null, 2));
  process.exit(0);
}

const created = await notion("/databases", {
  method: "POST",
  body: JSON.stringify({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "欠席連絡管理" } }],
    initial_data_source: {
      title: [{ type: "text", text: { content: "欠席連絡管理" } }],
      properties: {
        "連絡名": { title: {} },
        "生徒情報DB": { relation: { data_source_id: studentDataSourceId, type: "single_property", single_property: {} } },
        "学籍番号": { rich_text: {} },
        "種別": { select: { options: ["欠席", "遅刻", "振替希望", "その他"].map((name) => ({ name })) } },
        "対象日": { date: {} },
        "授業・クラス": { rich_text: {} },
        "科目": { rich_text: {} },
        "校舎": { select: { options: [{ name: "本校" }, { name: "南教室" }] } },
        "LINE原文": { rich_text: {} },
        "LINE受信日時": { date: {} },
        "確認者": { rich_text: {} },
        "確認日時": { date: {} },
        "状態": { select: { options: [{ name: "確認済み" }, { name: "取消し" }] } },
        "アプリ記録ID": { rich_text: {} },
      },
    },
  }),
});
console.log(JSON.stringify({ ok: true, created: true, database_id: created.id, data_source_id: created.data_sources?.[0]?.id ?? null }, null, 2));
