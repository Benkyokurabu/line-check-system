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

async function selectAll(client, table, columns) {
  const result = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < 1000) return result;
  }
}

function compact(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･()（）[\]【】「」『』]/g, "").toLowerCase();
}

function nameParts(value) {
  const parts = String(value ?? "").normalize("NFKC").trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) return { surname: compact(parts[0]), given: compact(parts.slice(1).join("")) };
  return { surname: "", given: "" };
}

function relation(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  if (/母|ママ/.test(normalized)) return "mother";
  if (/父|パパ/.test(normalized)) return "father";
  if (/保護者/.test(normalized)) return "guardian";
  if (/本人|生徒/.test(normalized)) return "student";
  return "unknown";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const [headers, ...data] = rows;
  return data.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function latestManagerChatsPath() {
  const files = fs.readdirSync(".")
    .filter((name) => /^line_manager_chats.*\.csv$/i.test(name))
    .map((name) => ({ name, modified: fs.statSync(name).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  return files[0] ? path.resolve(files[0].name) : null;
}

async function main() {
  loadEnv(path.resolve(".env.local"));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const [messages, accounts, aliases, roster] = await Promise.all([
    selectAll(client, "line_messages", "line_user_id,direction,text,display_name,received_at"),
    selectAll(client, "student_line_accounts", "line_user_id"),
    selectAll(client, "line_user_aliases", "line_user_id,alias_name"),
    selectAll(client, "student_roster", "student_number,student_name,grade,campus"),
  ]);

  const excluded = new Set();
  const backup = process.argv[2];
  if (backup && fs.existsSync(backup)) {
    for (const row of JSON.parse(fs.readFileSync(backup, "utf8"))) excluded.add(row.line_user_id);
  }
  const linked = new Set(accounts.map((row) => row.line_user_id));
  const aliasByUser = new Map(aliases.map((row) => [row.line_user_id, String(row.alias_name ?? "").trim()]));
  const managerAliasesByDisplay = new Map();
  const managerChatFile = latestManagerChatsPath();
  if (managerChatFile && fs.existsSync(managerChatFile)) {
    for (const chat of parseCsv(fs.readFileSync(managerChatFile, "utf8"))) {
      const displayKey = compact(chat.friend_display_name);
      const managerAlias = String(chat.alias_name ?? "").trim();
      if (!displayKey || !managerAlias) continue;
      if (!managerAliasesByDisplay.has(displayKey)) managerAliasesByDisplay.set(displayKey, new Set());
      managerAliasesByDisplay.get(displayKey).add(managerAlias);
    }
  }
  const inboundByUser = new Map();
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.line_user_id || linked.has(message.line_user_id) || excluded.has(message.line_user_id)) continue;
    if (!inboundByUser.has(message.line_user_id)) inboundByUser.set(message.line_user_id, []);
    inboundByUser.get(message.line_user_id).push(message);
  }

  const surnameCounts = new Map();
  const givenCounts = new Map();
  const preparedRoster = roster.map((student) => {
    const parts = nameParts(student.student_name);
    if (parts.surname) surnameCounts.set(parts.surname, (surnameCounts.get(parts.surname) ?? 0) + 1);
    if (parts.given) givenCounts.set(parts.given, (givenCounts.get(parts.given) ?? 0) + 1);
    return { ...student, full: compact(student.student_name), ...parts };
  });

  const rows = [];
  for (const [lineUserId, userMessages] of inboundByUser) {
    const sorted = [...userMessages].sort((a, b) => String(b.received_at ?? "").localeCompare(String(a.received_at ?? "")));
    const displayName = sorted.find((row) => String(row.display_name ?? "").trim())?.display_name?.trim() ?? "";
    const storedManagerName = aliasByUser.get(lineUserId) ?? "";
    const matchedManagerAliases = managerAliasesByDisplay.get(compact(displayName));
    const matchedManagerName = matchedManagerAliases?.size === 1 ? [...matchedManagerAliases][0] : "";
    const managerName = storedManagerName || matchedManagerName;
    const text = userMessages.map((row) => row.text ?? "").join("\n");
    const normalizedText = compact(text);
    const normalizedNames = compact(`${managerName}\n${displayName}`);
    const fullMatches = preparedRoster.filter((student) => student.full.length >= 3 && (normalizedText.includes(student.full) || normalizedNames.includes(student.full)));
    const givenMatches = preparedRoster.filter((student) => student.given.length >= 2 && givenCounts.get(student.given) === 1 && normalizedText.includes(student.given));
    const surnameMatches = preparedRoster.filter((student) => student.surname.length >= 1 && surnameCounts.get(student.surname) === 1 && normalizedNames.includes(student.surname));
    const candidates = new Map();
    for (const student of fullMatches) candidates.set(student.student_number, { student, evidence: "full_name" });
    for (const student of givenMatches) if (!candidates.has(student.student_number)) candidates.set(student.student_number, { student, evidence: "unique_given_name" });
    for (const student of surnameMatches) if (!candidates.has(student.student_number)) candidates.set(student.student_number, { student, evidence: "unique_surname_in_display_or_manager" });
    const relationValue = relation(`${managerName}\n${text}`);
    const evidenceMessages = userMessages
      .map((message) => String(message.text ?? "").replace(/\s+/g, " ").trim())
      .filter((messageText) => {
        const normalizedMessage = compact(messageText);
        return fullMatches.some((student) => normalizedMessage.includes(student.full)) || /母|父|保護者|本人/.test(messageText);
      });
    let confidence = "insufficient";
    if (fullMatches.length === 1 && relationValue !== "unknown") confidence = "high";
    else if (fullMatches.length === 1) confidence = "medium";
    else if (fullMatches.length === 0 && candidates.size === 1 && relationValue !== "unknown") confidence = "review";
    else if (candidates.size > 0) confidence = "review";
    const candidateText = [...candidates.values()].map(({ student, evidence }) => `${student.student_name}|${student.grade ?? ""}|${student.campus ?? ""}|${evidence}`).join(" / ");
    rows.push({
      confidence,
      line_user_id: lineUserId,
      display_name: displayName,
      manager_name: managerName,
      manager_name_source: storedManagerName ? "database" : matchedManagerName ? "unique_line_display_match" : "",
      relation: relationValue,
      candidates: candidateText,
      inbound_messages: userMessages.length,
      latest_at: sorted[0]?.received_at ?? "",
      evidence_sample: evidenceMessages.slice(0, 5).join(" / ").slice(0, 800),
      sample: sorted.map((row) => String(row.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3).join(" / ").slice(0, 500),
    });
  }
  const rank = { high: 0, medium: 1, review: 2, insufficient: 3 };
  rows.sort((a, b) => rank[a.confidence] - rank[b.confidence] || String(b.latest_at).localeCompare(String(a.latest_at)));
  const headers = Object.keys(rows[0] ?? {});
  fs.writeFileSync("unlinked_line_user_analysis_20260811.csv", [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n"), "utf8");
  const summary = rows.reduce((result, row) => ({ ...result, [row.confidence]: (result[row.confidence] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ total: rows.length, summary, output: "unlinked_line_user_analysis_20260811.csv" }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
