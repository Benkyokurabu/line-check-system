import fs from "node:fs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("Usage: node scripts/find-notion-student-by-name.mjs <name>");
  process.exit(1);
}

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=]+)=(.*)$/);
  if (!match) continue;
  const key = match[1].trim();
  const value = match[2].trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = value;
}

const token = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
if (!token) throw new Error("NOTION_TOKEN is not configured");

function textFromProperty(property) {
  if (!property) return "";
  if (property.type === "title") return property.title?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  if (property.type === "select") return property.select?.name?.trim() ?? "";
  if (property.type === "formula") {
    if (property.formula?.type === "string") return property.formula.string?.trim() ?? "";
    if (property.formula?.type === "number") return property.formula.number == null ? "" : String(property.formula.number);
    if (property.formula?.type === "boolean") return property.formula.boolean == null ? "" : String(property.formula.boolean);
    if (property.formula?.type === "date") return property.formula.date?.start?.trim() ?? "";
  }
  return "";
}

async function notionRequest(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": process.env.NOTION_VERSION ?? "2025-09-03",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `Notion API ${response.status}`);
  return body;
}

const body = await notionRequest("/search", {
  method: "POST",
  body: JSON.stringify({ query, page_size: 25 }),
});

const rows = (body.results ?? []).map((page) => {
  const properties = page.properties ?? {};
  return {
    id: page.id,
    url: page.url,
    student_number: textFromProperty(properties["学籍番号"]) || textFromProperty(properties["生徒番号"]) || textFromProperty(properties["番号"]),
    student_name: textFromProperty(properties["生徒氏名"]) || textFromProperty(properties["生徒名"]) || textFromProperty(properties["名前"]) || textFromProperty(properties["氏名"]),
    status: textFromProperty(properties["状態"]),
    grade: textFromProperty(properties["学年"]),
    campus: textFromProperty(properties["所属"]),
  };
}).filter((row) => row.student_name || row.student_number || row.status || row.grade || row.campus);

console.log(JSON.stringify({ query, match_count: rows.length, matches: rows }, null, 2));
