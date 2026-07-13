import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const DEFAULT_CHATS = "line_manager_chats.csv";
const DEFAULT_PROFILES = "line_profiles_export.csv";
const DEFAULT_OUTPUT = "line_history_roster_match_by_name.csv";

function parseArgs(argv) {
  const args = {
    apply: false,
    overwrite: false,
    chats: DEFAULT_CHATS,
    profiles: DEFAULT_PROFILES,
    output: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--overwrite") args.overwrite = true;
    else if (arg === "--chats" && next) {
      args.chats = next;
      i += 1;
    } else if (arg === "--profiles" && next) {
      args.profiles = next;
      i += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/link-line-history-via-manager-names.mjs [options]

Options:
  --chats <path>     CSV from export:line-manager-chats. Default: ${DEFAULT_CHATS}
  --profiles <path>  CSV from export:line-profiles. Default: ${DEFAULT_PROFILES}
  --output <path>    Match report CSV. Default: ${DEFAULT_OUTPUT}
  --apply            Write auto candidates to student_line_accounts.
  --overwrite        Also refresh the legacy student_line_links primary account.`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function createSupabase() {
  loadEnvFile(path.resolve(".env.local"));
  loadEnvFile(path.resolve(".env.vercel-import"));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function parseCsv(content) {
  const text = content.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function cellText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function gradeFromFileName(fileName) {
  const normalized = fileName.normalize("NFKC");
  const match = normalized.match(/([小中])\s*([1-6])/);
  if (!match) return "";
  return `${match[1]}${match[2]}`;
}

function readRoster(rootDir) {
  const files = fs
    .readdirSync(rootDir)
    .filter((file) => file.includes("クラス一覧表") && file.endsWith(".xlsx"));

  const rows = [];
  for (const file of files) {
    const workbook = XLSX.readFile(path.join(rootDir, file));
    const sheet = workbook.Sheets["クラス一覧表"] ?? workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
    const grade = gradeFromFileName(file);

    for (const record of records.slice(2)) {
      const studentNumber = cellText(record[1]);
      const studentName = cellText(record[2]);
      const homeroomTeacher = cellText(record[5]);
      if (!/^\d+$/.test(studentNumber) || !studentName) continue;
      rows.push({
        student_number: studentNumber,
        student_name: studentName,
        grade,
        homeroom_teacher: homeroomTeacher,
      });
    }
  }

  return [...new Map(rows.map((row) => [row.student_number, row])).values()];
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/[・･.。､,，、]/g, "");
}

function cleanPersonText(value) {
  return normalize(value)
    .replace(/(さん|様|くん|ちゃん)$/g, "")
    .replace(/(お母様|お母さん|母|父|保護者|ママ|パパ)$/g, "");
}

function relationFromAlias(value) {
  const text = String(value ?? "").normalize("NFKC");
  if (text.includes("母")) return "mother";
  if (text.includes("父")) return "father";
  if (text.includes("保護者")) return "guardian";
  if (/[家族]|兄|姉|弟|妹/.test(text)) return "family";
  return "student";
}

function indexByNormalized(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const key = cleanPersonText(row[field]);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function scoreAliasToStudent(aliasName, studentName) {
  const alias = cleanPersonText(aliasName);
  const student = normalize(studentName);
  if (!alias || !student) return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];
  if (alias === student) {
    score += 200;
    reasons.push("exact_student_name");
  }
  if (alias.includes(student)) {
    score += 150;
    reasons.push("alias_contains_student_name");
  }

  const parts = studentName
    .normalize("NFKC")
    .split(/[ \t\r\n\u3000]+/)
    .map((part) => normalize(part))
    .filter(Boolean);
  for (const part of parts) {
    if (part.length >= 2 && alias.includes(part)) {
      score += 40;
      reasons.push(`name_part:${part}`);
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

function chooseStudent(aliasName, roster) {
  const candidates = roster
    .map((student) => {
      const scored = scoreAliasToStudent(aliasName, student.student_name);
      return { student, ...scored };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  if (!top) return { status: "no_roster_match", top: null, alternatives: [] };
  const delta = top.score - (second?.score ?? 0);
  const status = top.score >= 150 && delta >= 40 ? "auto_candidate" : "review_roster_match";
  return { status, top, alternatives: candidates.slice(1, 4) };
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(outputPath, rows) {
  const headers = [
    "status",
    "history_line_user_id",
    "history_display_name",
    "manager_line_user_id",
    "manager_friend_display_name",
    "manager_alias_name",
    "student_number",
    "student_name",
    "grade",
    "homeroom_teacher",
    "score",
    "matched_by",
    "alternatives",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function selectExistingLinks(supabase) {
  const { data, error } = await supabase
    .from("student_line_links")
    .select("student_number,line_user_id");
  if (error) throw error;
  return data ?? [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chats = readCsv(args.chats).filter((row) => row.friend_display_name && row.alias_name);
  const profiles = readCsv(args.profiles).filter((row) => row.line_user_id);
  const roster = readRoster(process.cwd());
  const chatsByFriendName = indexByNormalized(chats, "friend_display_name");

  const rows = [];
  for (const profile of profiles) {
    const historyDisplayName = profile.profile_display_name || profile.stored_display_name;
    const matches = chatsByFriendName.get(cleanPersonText(historyDisplayName)) ?? [];
    if (matches.length !== 1) {
      rows.push({
        status: matches.length ? "review_manager_name_ambiguous" : "no_manager_name_match",
        history_line_user_id: profile.line_user_id,
        history_display_name: historyDisplayName,
        manager_line_user_id: "",
        manager_friend_display_name: "",
        manager_alias_name: "",
        student_number: "",
        student_name: "",
        grade: "",
        homeroom_teacher: "",
        score: "",
        matched_by: "",
        alternatives: "",
      });
      continue;
    }

    const manager = matches[0];
    const studentMatch = chooseStudent(manager.alias_name, roster);
    const top = studentMatch.top;
    rows.push({
      status: studentMatch.status,
      history_line_user_id: profile.line_user_id,
      history_display_name: historyDisplayName,
      manager_line_user_id: manager.line_user_id,
      manager_friend_display_name: manager.friend_display_name,
      manager_alias_name: manager.alias_name,
      student_number: top?.student.student_number ?? "",
      student_name: top?.student.student_name ?? "",
      grade: top?.student.grade ?? "",
      homeroom_teacher: top?.student.homeroom_teacher ?? "",
      score: top?.score ?? "",
      matched_by: top?.reasons.join("+") ?? "",
      alternatives: studentMatch.alternatives
        .map((candidate) => `${candidate.student.student_number}:${candidate.student.student_name}:${candidate.score}`)
        .join(" | "),
    });
  }

  const supabase = createSupabase();
  const existingLinks = await selectExistingLinks(supabase);
  const existingByStudent = new Map(existingLinks.map((link) => [link.student_number, link.line_user_id]));
  const accountsToApply = [];
  const primaryLinksByStudent = new Map();
  for (const row of rows) {
    if (row.status !== "auto_candidate" || !row.student_number || !row.history_line_user_id) continue;
    const relation = relationFromAlias(row.manager_alias_name);
    const isPrimary = relation === "mother" || relation === "guardian";
    accountsToApply.push({
      student_number: row.student_number,
      line_user_id: row.history_line_user_id,
      relation,
      alias_name: row.manager_alias_name,
      friend_display_name: row.history_display_name,
      source: "line_manager_name_match",
      is_primary: isPrimary,
      updated_at: new Date().toISOString(),
    });
    if (!primaryLinksByStudent.has(row.student_number) || isPrimary) {
      primaryLinksByStudent.set(row.student_number, row.history_line_user_id);
    }
  }

  writeCsv(args.output, rows);

  if (args.apply && accountsToApply.length > 0) {
    const { error } = await supabase
      .from("student_line_accounts")
      .upsert(accountsToApply, { onConflict: "student_number,line_user_id" });
    if (error && !["42P01", "PGRST205"].includes(error.code)) throw error;

    const aliasRows = accountsToApply.map((account) => ({
      line_user_id: account.line_user_id,
      alias_name: account.alias_name,
      updated_at: account.updated_at,
    }));
    const { error: aliasError } = await supabase
      .from("line_user_aliases")
      .upsert(aliasRows, { onConflict: "line_user_id" });
    if (aliasError) throw aliasError;

    const legacyLinks = [...primaryLinksByStudent.entries()]
      .filter(([studentNumber]) => args.overwrite || !existingByStudent.has(studentNumber))
      .map(([student_number, line_user_id]) => ({
        student_number,
        line_user_id,
        updated_at: new Date().toISOString(),
      }));
    if (legacyLinks.length > 0) {
      const { error: legacyError } = await supabase
        .from("student_line_links")
        .upsert(legacyLinks, { onConflict: "student_number" });
      if (legacyError) throw legacyError;
    }
  }

  const summary = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    profiles: profiles.length,
    manager_chats: chats.length,
    roster_students: roster.length,
    apply_candidates: accountsToApply.length,
    output: args.output,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
