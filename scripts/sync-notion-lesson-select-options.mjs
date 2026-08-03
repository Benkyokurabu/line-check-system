import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv(path.resolve(".env.local"));
const tokenFiles = [
  path.join(os.homedir(), ".codex", "notion_token.txt"),
  path.resolve("notionアクセストークン.txt"),
];
const tokenFile = tokenFiles.find((file) => fs.existsSync(file));
const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || (tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : "");
const dataSourceId = process.env.NOTION_ABSENCE_DATA_SOURCE_ID || process.env.NOTION_ATTENDANCE_DATA_SOURCE_ID || "19ef0120-80a7-805c-ae16-000b7b414034";
const propertyName = process.env.NOTION_ATTENDANCE_LESSON_PROPERTY || "授業";
const apply = process.argv.includes("--apply");

if (!notionToken) throw new Error("Notion token is not available");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Supabase environment variables are required");

async function notion(endpoint, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": process.env.NOTION_VERSION || "2025-09-03",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message || "request failed"}`);
  return body;
}

function fullWidth(value) {
  return value.normalize("NFKC").replace(/[0-9A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0));
}

function lessonOption(row) {
  const payload = row.source_payload || {};
  const grade = { j1: "1", j2: "2", j3: "3", e4: "4", e5: "5", e6: "6" }[String(payload.grade || "")] || "";
  const subject = { eng: "英", math: "数", arith: "算", jp: "国", sci: "理", soc: "社" }[String(payload.subject || "")] || "";
  const className = String(payload.class || "").trim();
  if (grade && className && subject) return fullWidth(`${grade}${className}${subject}`);
  return String(row.label || "").trim();
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: lessons, error } = await supabase.from("lessons").select("label,source_payload");
if (error) throw error;

const required = [...new Set((lessons || []).map(lessonOption).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
const dataSource = await notion(`/data_sources/${dataSourceId}`);
const property = dataSource.properties?.[propertyName];
if (!property) throw new Error(`Notion property not found: ${propertyName}`);
if (property.type !== "select") throw new Error(`Notion property is not select: ${propertyName} (${property.type})`);

const existing = property.select?.options || [];
const existingNames = new Set(existing.map((option) => option.name));
const missing = required.filter((name) => !existingNames.has(name));
console.log(JSON.stringify({ apply, property: propertyName, existing: existing.length, required: required.length, missing }, null, 2));

if (apply && missing.length > 0) {
  await notion(`/data_sources/${dataSourceId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [property.id]: {
          select: {
            options: [
              ...existing.map((option) => ({ id: option.id })),
              ...missing.map((name) => ({ name })),
            ],
          },
        },
      },
    }),
  });
  console.log(JSON.stringify({ ok: true, added: missing.length }, null, 2));
}
