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

function compact(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･()（）[\]【】「」『』、。,.!！?？:：]/g, "").replaceAll("髙", "高").toLowerCase();
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

async function selectAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function main() {
  loadEnv(path.resolve(".env.local"));
  const specPath = readArg("spec");
  const apply = process.argv.includes("--apply");
  if (!specPath) throw new Error("Required: --spec=<reviewed-candidates.json>");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Supabase credentials are required.");

  const specs = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8"));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const [messages, accounts, aliases, roster, legacyLinks] = await Promise.all([
    selectAll(client, "line_messages", "line_user_id,direction,text,display_name,received_at"),
    selectAll(client, "student_line_accounts", "student_number,line_user_id"),
    selectAll(client, "line_user_aliases", "line_user_id,alias_name"),
    selectAll(client, "student_roster", "student_number,student_name,grade,campus"),
    selectAll(client, "student_line_links", "student_number,line_user_id"),
  ]);

  const accountsByUser = new Map();
  for (const account of accounts) {
    if (!accountsByUser.has(account.line_user_id)) accountsByUser.set(account.line_user_id, []);
    accountsByUser.get(account.line_user_id).push(account);
  }
  const aliasByUser = new Map(aliases.map((row) => [row.line_user_id, row.alias_name ?? ""]));
  const managerAliasesByDisplay = new Map();
  const managerChatsPath = latestManagerChatsPath();
  if (managerChatsPath) {
    for (const chat of parseCsv(fs.readFileSync(managerChatsPath, "utf8"))) {
      const key = compact(chat.friend_display_name);
      const alias = String(chat.alias_name ?? "").trim();
      if (!key || !alias) continue;
      if (!managerAliasesByDisplay.has(key)) managerAliasesByDisplay.set(key, new Set());
      managerAliasesByDisplay.get(key).add(alias);
    }
  }
  const rosterByName = new Map(roster.map((row) => [compact(row.student_name), row]));
  const messagesByUser = new Map();
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.line_user_id) continue;
    if (!messagesByUser.has(message.line_user_id)) messagesByUser.set(message.line_user_id, []);
    messagesByUser.get(message.line_user_id).push(message);
  }

  const resolved = [];
  const errors = [];
  for (const spec of specs) {
    const candidates = [];
    for (const [lineUserId, userMessages] of messagesByUser) {
      const sorted = [...userMessages].sort((left, right) => String(right.received_at ?? "").localeCompare(String(left.received_at ?? "")));
      const displayName = sorted.find((row) => String(row.display_name ?? "").trim())?.display_name?.trim() ?? "";
      if (compact(displayName) !== compact(spec.display_name)) continue;
      const combinedText = compact(userMessages.map((row) => row.text ?? "").join("\n"));
      if (!(spec.required_terms ?? []).every((term) => combinedText.includes(compact(term)))) continue;
      const storedAlias = aliasByUser.get(lineUserId) ?? "";
      const displayAliases = managerAliasesByDisplay.get(compact(displayName));
      const managerAlias = displayAliases?.size === 1 ? [...displayAliases][0] : "";
      const alias = storedAlias || managerAlias;
      if (spec.required_alias_term && !compact(alias).includes(compact(spec.required_alias_term))) continue;
      candidates.push({ line_user_id: lineUserId, display_name: displayName, alias_name: alias, message_count: userMessages.length });
    }
    if (candidates.length !== 1) {
      errors.push({ display_name: spec.display_name, student_names: spec.student_names, reason: `matching_accounts=${candidates.length}` });
      continue;
    }
    const students = spec.student_names.map((studentName) => rosterByName.get(compact(studentName))).filter(Boolean);
    if (students.length !== spec.student_names.length) {
      const missing = spec.student_names.filter((studentName) => !rosterByName.has(compact(studentName)));
      errors.push({ display_name: spec.display_name, student_names: spec.student_names, reason: `not_in_active_roster=${missing.join(",")}` });
      continue;
    }
    const targetNumbers = new Set(students.map((student) => student.student_number));
    const conflictingAccounts = (accountsByUser.get(candidates[0].line_user_id) ?? []).filter((account) => !targetNumbers.has(account.student_number));
    if (conflictingAccounts.length) {
      errors.push({ display_name: spec.display_name, student_names: spec.student_names, reason: `linked_to_other_students=${conflictingAccounts.length}` });
      continue;
    }
    for (const student of students) resolved.push({ spec, candidate: candidates[0], student });
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    account_count: new Set(resolved.map((row) => row.candidate.line_user_id)).size,
    link_count: resolved.length,
    candidates: resolved.map((row) => ({
      display_name: row.candidate.display_name,
      student_name: row.student.student_name,
      relation: row.spec.relation,
      grade: row.student.grade,
      campus: row.student.campus,
      evidence_terms: row.spec.required_terms ?? [],
      alias_verified: Boolean(row.spec.required_alias_term),
    })),
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length) throw new Error("Some reviewed candidates could not be resolved uniquely; nothing was changed.");
  if (!apply || !resolved.length) return;

  const now = new Date().toISOString();
  const rowsToApply = resolved.map(({ spec, candidate, student }) => ({
    student_number: student.student_number,
    line_user_id: candidate.line_user_id,
    relation: spec.relation,
    alias_name: candidate.alias_name || null,
    friend_display_name: candidate.display_name || null,
    source: "human_reviewed_line_inference",
    is_primary: spec.relation === "mother" || spec.relation === "guardian",
    updated_at: now,
  }));
  const { error: accountError } = await client.from("student_line_accounts").upsert(rowsToApply, { onConflict: "student_number,line_user_id" });
  if (accountError) throw accountError;

  const legacyStudents = new Set(legacyLinks.map((row) => row.student_number));
  const legacyByStudent = new Map();
  const priority = { mother: 4, guardian: 3, student: 2, father: 1, family: 0, unknown: 0 };
  for (const row of rowsToApply.filter((candidate) => !legacyStudents.has(candidate.student_number))) {
    const current = legacyByStudent.get(row.student_number);
    if (!current || priority[row.relation] > priority[current.relation]) legacyByStudent.set(row.student_number, row);
  }
  const legacyRows = [...legacyByStudent.values()].map((row) => ({ student_number: row.student_number, line_user_id: row.line_user_id, updated_at: now }));
  if (legacyRows.length) {
    const { error: legacyError } = await client.from("student_line_links").upsert(legacyRows, { onConflict: "student_number" });
    if (legacyError) throw legacyError;
  }

  const { data: verified, error: verifyError } = await client
    .from("student_line_accounts")
    .select("student_number,relation,friend_display_name,source")
    .eq("source", "human_reviewed_line_inference");
  if (verifyError) throw verifyError;
  const targetNumbers = new Set(rowsToApply.map((row) => row.student_number));
  const verifiedTargets = (verified ?? []).filter((row) => targetNumbers.has(row.student_number));
  if (verifiedTargets.length < rowsToApply.length) throw new Error(`Verification failed: expected ${rowsToApply.length}, found ${verifiedTargets.length}`);
  console.log(JSON.stringify({ applied: true, verified_link_count: verifiedTargets.length }, null, 2));
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
