import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_STUDENT_DATA_SOURCE_ID = "19ef0120-80a7-80b7-9f23-000b21e0a53b";
const NOTION_VERSION = process.env.NOTION_VERSION ?? "2025-09-03";
const SYNC_STUDENT_STATUSES = ["在塾", "見学中"];
const PLACEHOLDER_STUDENT_NUMBERS = new Set(["2020000"]);

loadEnv();

const supabaseUrl = requiredEnv("SUPABASE_URL");
const supabaseSecretKey = requiredEnv("SUPABASE_SECRET_KEY");
const notionToken = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
if (!notionToken) throw new Error("NOTION_TOKEN is not configured");

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function loadEnv() {
  if (!fs.existsSync(".env.local")) return;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function normalizeStudentNumber(value) {
  return String(value ?? "").normalize("NFKC").replace(/[^\d]/g, "");
}


function notionStudentNumber(pageId, rawStudentNumber, status, isDuplicate) {
  if (status !== "在塾" || !rawStudentNumber || PLACEHOLDER_STUDENT_NUMBERS.has(rawStudentNumber) || isDuplicate) {
    return `notion:${pageId.replace(/-/g, "")}`;
  }
  return rawStudentNumber;
}

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

function firstProperty(properties, names) {
  for (const name of names) {
    const value = textFromProperty(properties[name]);
    if (value) return value;
  }
  return "";
}

async function notionRequest(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : `Notion API ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function fetchNotionStudents() {
  const dataSourceId = process.env.NOTION_STUDENT_DATA_SOURCE_ID?.trim() || DEFAULT_STUDENT_DATA_SOURCE_ID;
  const candidates = [];
  let skipped = 0;
  let cursor;

  do {
    const body = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        filter: { or: SYNC_STUDENT_STATUSES.map((status) => ({ property: "状態", select: { equals: status } })) },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });

    for (const page of body.results ?? []) {
      const properties = page.properties ?? {};
      const rawStudentNumber = normalizeStudentNumber(firstProperty(properties, ["学籍番号", "生徒番号", "番号"]));
      const status = firstProperty(properties, ["状態"]);
      const studentName = firstProperty(properties, ["生徒氏名", "名前", "氏名"]);
      if (!studentName) {
        skipped += 1;
        continue;
      }
      candidates.push({
        raw_student_number: rawStudentNumber,
        status,
        student_name: studentName,
        notion_page_id: page.id,
        grade: firstProperty(properties, ["学年"]) || null,
        campus: firstProperty(properties, ["所属"]) || null,
        homeroom_teacher: firstProperty(properties, ["担任"]) || null,
        school_name: firstProperty(properties, ["中学校", "小学校"]) || null,
        gender: firstProperty(properties, ["性別"]) || null,
        instruction_type: firstProperty(properties, ["授業形態", "指導形態", "受講形態"]) || null,
      });
    }

    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);

  const numberCounts = candidates.reduce((counts, student) => {
    if (student.raw_student_number) counts.set(student.raw_student_number, (counts.get(student.raw_student_number) ?? 0) + 1);
    return counts;
  }, new Map());
  const students = candidates.map((student) => ({
    student_number: notionStudentNumber(
      student.notion_page_id,
      student.raw_student_number,
      student.status,
      (numberCounts.get(student.raw_student_number) ?? 0) > 1,
    ),
    student_name: student.student_name,
    notion_page_id: student.notion_page_id,
    grade: student.grade,
    campus: student.campus,
    homeroom_teacher: student.homeroom_teacher,
    school_name: student.school_name,
    gender: student.gender,
  }));

  return {
    students: [...new Map(students.map((student) => [student.student_number, student])).values()],
    skipped,
  };
}

async function main() {
  const notionResult = await fetchNotionStudents();
  const studentNumbers = notionResult.students.map((student) => student.student_number);
  if (studentNumbers.length === 0) {
    console.log(JSON.stringify({ ok: true, active_students: 0, synced_students: 0, skipped: notionResult.skipped }, null, 2));
    return;
  }

  const { data: currentRows, error: currentError } = await supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,school_name,gender,instruction_type,source_file")
    .in("student_number", studentNumbers);
  if (currentError) throw new Error(currentError.message);

  const currentByNumber = new Map((currentRows ?? []).map((row) => [row.student_number, row]));
  const updatedAt = new Date().toISOString();
  const rows = notionResult.students.map((student) => {
    const current = currentByNumber.get(student.student_number);
    return {
      student_number: student.student_number,
      student_name: student.student_name,
      grade: student.grade || current?.grade || "未設定",
      homeroom_teacher: student.homeroom_teacher || current?.homeroom_teacher || "未設定",
      campus: student.campus || current?.campus || null,
      school_name: student.school_name || current?.school_name || null,
      gender: student.gender || current?.gender || null,
      instruction_type: student.instruction_type || current?.instruction_type || null,
      source_file: current?.source_file || "Notion生徒情報DB",
      updated_at: updatedAt,
    };
  });

  const { error: syncError } = await supabase
    .from("student_roster")
    .upsert(rows, { onConflict: "student_number" });
  if (syncError) throw new Error(syncError.message);

  console.log(JSON.stringify({
    ok: true,
    active_students: notionResult.students.length,
    synced_students: rows.length,
    skipped: notionResult.skipped,
    synced_at: updatedAt,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});


