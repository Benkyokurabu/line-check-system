import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function propertyText(property) {
  if (!property) return "";
  if (property.type === "title") return property.title?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  if (property.type === "select") return property.select?.name?.trim() ?? "";
  if (property.type === "formula") return String(property.formula?.string ?? property.formula?.number ?? "").trim();
  return "";
}

function compact(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･()（）[\]【】「」『』、。,.!！?？:：]/g, "").replaceAll("髙", "高").toLowerCase();
}

function relationFor(textValue, studentName) {
  const text = compact(textValue);
  const name = compact(studentName);
  if (!name || !text.includes(name)) return null;
  if (text.includes(`${name}の母です`) || text.includes(`${name}母です`)) return "mother";
  if (text.includes(`${name}の父です`) || text.includes(`${name}父です`)) return "father";
  if (text.includes(`${name}の保護者です`) || text.includes(`${name}保護者です`)) return "guardian";
  if (text.includes(`${name}本人です`) || text.includes(`生徒の${name}です`) || text === `${name}です`) return "student";
  return null;
}

async function selectAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function notionStudents() {
  const token = process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_STUDENT_DATA_SOURCE_ID?.trim() || "19ef0120-80a7-80b7-9f23-000b21e0a53b";
  const rows = [];
  let cursor;
  do {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Notion-Version": process.env.NOTION_VERSION ?? "2025-09-03" },
      body: JSON.stringify({
        page_size: 100,
        filter: {
          or: ["在塾", "見学中"].map((status) => ({ property: "状態", select: { equals: status } })),
        },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? `Notion API ${response.status}`);
    for (const page of body.results ?? []) {
      const properties = page.properties ?? {};
      const studentName = propertyText(properties["生徒氏名"]) || propertyText(properties["生徒名"]) || propertyText(properties["名前"]) || propertyText(properties["氏名"]);
      if (!studentName) continue;
      rows.push({
        student_name: studentName,
        status: propertyText(properties["状態"]),
        grade: propertyText(properties["学年"]),
        campus: propertyText(properties["所属"]),
      });
    }
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  loadEnv(path.resolve(".env.local"));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const [messages, accounts, roster, notion, legacyLinks] = await Promise.all([
    selectAll(client, "line_messages", "line_user_id,direction,text,display_name,received_at"),
    selectAll(client, "student_line_accounts", "line_user_id"),
    selectAll(client, "student_roster", "student_number,student_name"),
    notionStudents(),
    selectAll(client, "student_line_links", "student_number,line_user_id"),
  ]);
  const linked = new Set(accounts.map((row) => row.line_user_id));
  const rosterByName = new Map(roster.map((row) => [compact(row.student_name), row]));
  const people = [...new Map([...roster, ...notion].map((row) => [compact(row.student_name), row])).values()];
  const matches = [];
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.line_user_id || linked.has(message.line_user_id) || !message.text) continue;
    for (const person of people) {
      const relation = relationFor(message.text, person.student_name);
      if (!relation) continue;
      matches.push({
        line_user_id: message.line_user_id,
        display_name: message.display_name ?? "",
        student_name: person.student_name,
        relation,
        notion_status: person.status ?? "",
        grade: person.grade ?? "",
        campus: person.campus ?? "",
        in_roster: rosterByName.has(compact(person.student_name)),
        received_at: message.received_at,
        evidence: String(message.text).replace(/\s+/g, " ").slice(0, 180),
      });
    }
  }
  const relationPriority = { mother: 4, father: 4, student: 4, guardian: 3 };
  const uniqueByAccountAndStudent = new Map();
  for (const match of matches) {
    const key = `${match.line_user_id}|${compact(match.student_name)}`;
    const current = uniqueByAccountAndStudent.get(key);
    if (!current || relationPriority[match.relation] > relationPriority[current.relation]) uniqueByAccountAndStudent.set(key, match);
  }
  const unique = [...uniqueByAccountAndStudent.values()];
  const rowsToApply = unique.map((row) => ({
    student_number: rosterByName.get(compact(row.student_name)).student_number,
    line_user_id: row.line_user_id,
    relation: row.relation,
    alias_name: null,
    friend_display_name: row.display_name || null,
    source: "line_message_explicit_identity",
    is_primary: row.relation === "mother" || row.relation === "guardian",
    updated_at: new Date().toISOString(),
  }));
  if (apply && rowsToApply.length) {
    const { error: accountError } = await client.from("student_line_accounts").upsert(rowsToApply, { onConflict: "student_number,line_user_id" });
    if (accountError) throw accountError;
    const legacyStudents = new Set(legacyLinks.map((row) => row.student_number));
    const legacyPriority = { mother: 4, guardian: 3, student: 2, father: 1 };
    const legacyByStudent = new Map();
    for (const row of rowsToApply.filter((candidate) => !legacyStudents.has(candidate.student_number))) {
      const current = legacyByStudent.get(row.student_number);
      if (!current || legacyPriority[row.relation] > legacyPriority[current.relation]) legacyByStudent.set(row.student_number, row);
    }
    const legacyRows = [...legacyByStudent.values()].map((row) => ({
      student_number: row.student_number,
      line_user_id: row.line_user_id,
      updated_at: row.updated_at,
    }));
    if (legacyRows.length) {
      const { error: legacyError } = await client.from("student_line_links").upsert(legacyRows, { onConflict: "student_number" });
      if (legacyError) throw legacyError;
    }
  }
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    count: unique.length,
    relation_counts: unique.reduce((counts, row) => ({ ...counts, [row.relation]: (counts[row.relation] ?? 0) + 1 }), {}),
    candidates: unique.map((row) => ({
      display_name: row.display_name,
      student_name: row.student_name,
      relation: row.relation,
      notion_status: row.notion_status,
      evidence: row.evidence,
    })),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
