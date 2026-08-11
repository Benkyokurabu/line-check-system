import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");

function latestManagerChatsPath() {
  const files = fs.readdirSync(".")
    .filter((name) => /^line_manager_chats.*\.csv$/i.test(name))
    .map((name) => ({ name, modified: fs.statSync(name).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  return files[0] ? path.resolve(files[0].name) : null;
}

const managerChatsPath = latestManagerChatsPath();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function createSupabase() {
  loadEnvFile(path.resolve(".env.local"));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function selectAll(supabase, table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s　・･()（）[\]【】「」『』]/g, "")
    .toLowerCase();
}

function relationFromManagerName(value) {
  const text = String(value ?? "").normalize("NFKC");
  if (text.includes("母")) return "mother";
  if (text.includes("父")) return "father";
  if (text.includes("保護者")) return "guardian";
  if (/[家族]|兄|姉|弟|妹/.test(text)) return "family";
  if (/本人|生徒/.test(text)) return "student";
  return "student";
}

function relationFromMessageForStudent(value, studentName) {
  const text = normalize(value);
  const name = normalize(studentName);
  if (!name || !text.includes(name)) return null;
  if (text.includes(`${name}の母`) || text.includes(`${name}母`)) return "mother";
  if (text.includes(`${name}の父`) || text.includes(`${name}父`)) return "father";
  if (text.includes(`${name}の保護者`) || text.includes(`${name}保護者`)) return "guardian";
  if (text.includes(`${name}本人`) || text.includes(`${name}です`)) return "student";
  return null;
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

function uniqueStudentsNamedIn(text, roster) {
  const normalizedText = normalize(text);
  return roster.filter((student) => {
    const studentName = normalize(student.student_name);
    return studentName.length >= 3 && normalizedText.includes(studentName);
  });
}

async function main() {
  const supabase = createSupabase();
  const [messages, accounts, aliases, roster, legacyLinks] = await Promise.all([
    selectAll(supabase, "line_messages", "line_user_id,direction,text,display_name,received_at"),
    selectAll(supabase, "student_line_accounts", "student_number,line_user_id"),
    selectAll(supabase, "line_user_aliases", "line_user_id,alias_name"),
    selectAll(supabase, "student_roster", "student_number,student_name"),
    selectAll(supabase, "student_line_links", "student_number,line_user_id"),
  ]);

  const linkedLineUsers = new Set(accounts.map((row) => row.line_user_id));
  const existingPairs = new Set(accounts.map((row) => `${row.student_number}|${row.line_user_id}`));
  const aliasesByLineUser = new Map(aliases.map((row) => [row.line_user_id, row.alias_name ?? ""]));
  const managerAliasesByDisplay = new Map();
  if (managerChatsPath && fs.existsSync(managerChatsPath)) {
    for (const chat of parseCsv(fs.readFileSync(managerChatsPath, "utf8"))) {
      const displayKey = normalize(chat.friend_display_name);
      const managerAlias = String(chat.alias_name ?? "").trim();
      if (!displayKey || !managerAlias) continue;
      if (!managerAliasesByDisplay.has(displayKey)) managerAliasesByDisplay.set(displayKey, new Set());
      managerAliasesByDisplay.get(displayKey).add(managerAlias);
    }
  }
  const messagesByLineUser = new Map();
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.line_user_id || linkedLineUsers.has(message.line_user_id)) continue;
    if (!messagesByLineUser.has(message.line_user_id)) messagesByLineUser.set(message.line_user_id, []);
    messagesByLineUser.get(message.line_user_id).push(message);
  }

  const candidates = [];
  const conflicts = [];
  for (const [lineUserId, userMessages] of messagesByLineUser) {
    const latestProfile = [...userMessages]
      .sort((left, right) => String(right.received_at ?? "").localeCompare(String(left.received_at ?? "")))
      .find((message) => message.display_name?.trim());
    const friendDisplayName = latestProfile?.display_name?.trim() ?? "";
    const matchedAliases = managerAliasesByDisplay.get(normalize(friendDisplayName));
    const matchedManagerName = matchedAliases?.size === 1 ? [...matchedAliases][0] : "";
    const managerName = (aliasesByLineUser.get(lineUserId) ?? "").trim() || matchedManagerName;
    if (/検証用|テスト送信者/.test(`${managerName}\n${friendDisplayName}`)) continue;
    const managerStudents = uniqueStudentsNamedIn(managerName, roster);
    const managerRelation = relationFromManagerName(managerName);
    const managerEvidence = managerStudents.length === 1 && managerRelation
      ? { student: managerStudents[0], relation: managerRelation }
      : null;

    const messageMatches = [];
    for (const message of userMessages) {
      for (const student of uniqueStudentsNamedIn(message.text, roster)) {
        const matchedRelation = relationFromMessageForStudent(message.text, student.student_name);
        if (matchedRelation) messageMatches.push({ student, relation: matchedRelation });
      }
    }
    const distinctMessageMatches = [...new Map(messageMatches.map((match) => [`${match.student.student_number}|${match.relation}`, match])).values()];
    const messageStudents = new Set(distinctMessageMatches.map((match) => match.student.student_number));
    const messageRelations = new Set(distinctMessageMatches.map((match) => match.relation));
    const messageEvidence = messageStudents.size === 1 && messageRelations.size === 1
      ? distinctMessageMatches[0]
      : null;

    if (managerEvidence && messageEvidence && managerEvidence.student.student_number !== messageEvidence.student.student_number) {
      conflicts.push(lineUserId);
      continue;
    }
    const evidence = managerEvidence && messageEvidence
      ? { student: managerEvidence.student, relation: messageEvidence.relation, source: "line_manager_and_message_explicit_match" }
      : managerEvidence
        ? { ...managerEvidence, source: "line_manager_name_exact_match" }
        : messageEvidence
          ? { ...messageEvidence, source: "line_message_full_name_relation_exact" }
          : null;
    if (!evidence || existingPairs.has(`${evidence.student.student_number}|${lineUserId}`)) continue;

    candidates.push({
      student_number: evidence.student.student_number,
      line_user_id: lineUserId,
      relation: evidence.relation,
      alias_name: managerName.trim() || null,
      friend_display_name: friendDisplayName || null,
      source: evidence.source,
      is_primary: evidence.relation === "mother" || evidence.relation === "guardian",
      updated_at: new Date().toISOString(),
    });
  }

  const relationCounts = candidates.reduce((counts, row) => {
    counts[row.relation] = (counts[row.relation] ?? 0) + 1;
    return counts;
  }, {});
  const sourceCounts = candidates.reduce((counts, row) => {
    counts[row.source] = (counts[row.source] ?? 0) + 1;
    return counts;
  }, {});

  if (conflicts.length) throw new Error(`Conflicting student evidence found for ${conflicts.length} LINE account(s).`);
  if (apply && candidates.length) {
    const { error: accountError } = await supabase
      .from("student_line_accounts")
      .upsert(candidates, { onConflict: "student_number,line_user_id" });
    if (accountError) throw accountError;

    const legacyStudents = new Set(legacyLinks.map((row) => row.student_number));
    const newLegacyLinks = candidates
      .filter((row) => !legacyStudents.has(row.student_number))
      .map((row) => ({ student_number: row.student_number, line_user_id: row.line_user_id, updated_at: row.updated_at }));
    if (newLegacyLinks.length) {
      const { error: legacyError } = await supabase
        .from("student_line_links")
        .upsert(newLegacyLinks, { onConflict: "student_number" });
      if (legacyError) throw legacyError;
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    unlinked_line_users: messagesByLineUser.size,
    candidates: candidates.length,
    conflicts: conflicts.length,
    relation_counts: relationCounts,
    source_counts: sourceCounts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
