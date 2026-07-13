import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_OUTPUT = "line_student_link_candidates.csv";
const DEFAULT_MIN_SCORE = 100;
const DEFAULT_DELTA = 20;
const DEFAULT_FIRST_MESSAGES = 8;
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = {
    apply: false,
    overwrite: false,
    output: DEFAULT_OUTPUT,
    minScore: DEFAULT_MIN_SCORE,
    minDelta: DEFAULT_DELTA,
    firstMessages: DEFAULT_FIRST_MESSAGES,
    limitUsers: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--overwrite") args.overwrite = true;
    else if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--min-score" && next) {
      args.minScore = Number(next);
      i += 1;
    } else if (arg === "--min-delta" && next) {
      args.minDelta = Number(next);
      i += 1;
    } else if (arg === "--first-messages" && next) {
      args.firstMessages = Number(next);
      i += 1;
    } else if (arg === "--limit-users" && next) {
      args.limitUsers = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.minScore)) args.minScore = DEFAULT_MIN_SCORE;
  if (!Number.isFinite(args.minDelta)) args.minDelta = DEFAULT_DELTA;
  if (!Number.isFinite(args.firstMessages) || args.firstMessages < 1) {
    args.firstMessages = DEFAULT_FIRST_MESSAGES;
  }
  if (args.limitUsers !== null && (!Number.isFinite(args.limitUsers) || args.limitUsers < 1)) {
    args.limitUsers = null;
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run link:students -- [options]

Options:
  --output <path>          Candidate CSV path. Default: ${DEFAULT_OUTPUT}
  --min-score <number>     Minimum score for automatic link candidates. Default: ${DEFAULT_MIN_SCORE}
  --min-delta <number>     Required score gap from the second candidate. Default: ${DEFAULT_DELTA}
  --first-messages <num>   Number of oldest messages to inspect per LINE user. Default: ${DEFAULT_FIRST_MESSAGES}
  --limit-users <num>      Inspect only the first N LINE users. Useful for a small verification run.
  --apply                  Write high-confidence links to student_line_links.
  --overwrite              With --apply, overwrite existing links for the same student_number.

Default mode is dry-run: it writes only a CSV and does not update the database.`);
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

async function selectAll(supabase, table, columns, buildQuery = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const query = buildQuery(supabase.from(table).select(columns)).range(from, to);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[‐-‒–—―ーｰ－]/g, "-");
}

function digitsOnly(value) {
  return String(value ?? "").normalize("NFKC").replace(/\D/g, "");
}

function compactName(value) {
  return normalizeText(value).replace(/[・･.．,，、。]/g, "");
}

function excerpt(text, needle) {
  const source = String(text ?? "").replace(/\r?\n/g, " ");
  if (!source) return "";
  const normalizedSource = normalizeText(source);
  const normalizedNeedle = normalizeText(needle);
  const index = normalizedNeedle ? normalizedSource.indexOf(normalizedNeedle) : -1;
  if (index < 0) return source.slice(0, 120);
  return source.slice(Math.max(0, index - 30), index + normalizedNeedle.length + 80);
}

function extractGreetingNames(messages) {
  const names = new Set();
  const patterns = [
    /こんにちは\s*([^\s　、。,.，!！?？「」『』\r\n]{2,20})\s*さん/g,
    /こんにちわ\s*([^\s　、。,.，!！?？「」『』\r\n]{2,20})\s*さん/g,
    /([^\s　、。,.，!！?？「」『』\r\n]{2,20})\s*さん\s*こんにちは/g,
    /([^\s　、。,.，!！?？「」『』\r\n]{2,20})\s*様/g,
  ];

  for (const message of messages) {
    const text = String(message.text ?? "").normalize("NFKC");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1]?.trim();
        if (!name) continue;
        if (["line", "LINE", "保護者", "お客様", "友だち"].includes(name)) continue;
        names.add(name);
      }
    }
  }

  return [...names];
}

function scoreStudent(student, messages, displayName, aliasName, greetingNames) {
  const studentNumber = String(student.student_number ?? "");
  const studentDigits = digitsOnly(studentNumber);
  const studentName = String(student.student_name ?? "");
  const normalizedName = compactName(studentName);
  const normalizedDisplayName = compactName(displayName);
  const normalizedAliasName = compactName(aliasName);
  const normalizedGreetingNames = greetingNames.map((name) => ({
    original: name,
    normalized: compactName(name),
  }));

  let score = 0;
  const reasons = [];
  let matchedText = "";
  let matchedAt = "";

  if (studentDigits.length >= 4) {
    for (const message of messages) {
      const textDigits = digitsOnly(message.text);
      if (textDigits.includes(studentDigits)) {
        score += 100;
        reasons.push("student_number");
        matchedText ||= excerpt(message.text, studentNumber);
        matchedAt ||= message.received_at ?? message.created_at ?? "";
        break;
      }
    }
  }

  if (normalizedName.length >= 2) {
    for (const message of messages) {
      const normalizedMessage = compactName(message.text);
      if (normalizedMessage.includes(normalizedName)) {
        score += 80;
        reasons.push("student_name");
        matchedText ||= excerpt(message.text, studentName);
        matchedAt ||= message.received_at ?? message.created_at ?? "";
        break;
      }
    }
  }

  if (normalizedDisplayName && normalizedName && normalizedDisplayName.includes(normalizedName)) {
    score += 25;
    reasons.push("line_display_name");
  }

  if (normalizedAliasName && normalizedName && normalizedAliasName.includes(normalizedName)) {
    score += 120;
    reasons.push("school_alias_name");
  }

  for (const name of normalizedGreetingNames) {
    if (!name.normalized) continue;
    if (name.normalized.includes(normalizedName) || normalizedName.includes(name.normalized)) {
      score += 70;
      reasons.push("auto_reply_greeting_name");
      break;
    }
  }

  return {
    student,
    score,
    reasons,
    matchedText,
    matchedAt,
  };
}

function chooseCandidate(students, messages, displayName, aliasName, greetingNames, minScore, minDelta) {
  const ranked = students
    .map((student) => scoreStudent(student, messages, displayName, aliasName, greetingNames))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  if (!top) {
    return { status: "no_match", top: null, second: null, alternatives: [] };
  }

  const delta = top.score - (second?.score ?? 0);
  const status =
    top.score >= minScore && delta >= minDelta
      ? "auto_candidate"
      : "review";

  return {
    status,
    top,
    second,
    alternatives: ranked.slice(1, 4),
  };
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(outputPath, rows) {
  const headers = [
    "status",
    "line_user_id",
    "line_display_name",
    "school_alias_name",
    "score",
    "student_number",
    "student_name",
    "grade",
    "homeroom_teacher",
    "matched_by",
    "auto_reply_names",
    "matched_at",
    "matched_text",
    "existing_student_number",
    "alternatives",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  // Excel on Windows detects UTF-8 CSV reliably when it starts with a BOM.
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabase();

  const [students, existingLinks, aliases, messages] = await Promise.all([
    selectAll(
      supabase,
      "student_roster",
      "student_number,student_name,grade,homeroom_teacher,campus,school_name",
      (query) => query.order("student_number", { ascending: true }),
    ),
    selectAll(supabase, "student_line_links", "student_number,line_user_id"),
    selectAll(supabase, "line_user_aliases", "line_user_id,alias_name,group_name"),
    selectAll(
      supabase,
      "line_messages",
      "line_user_id,display_name,text,received_at,created_at,direction",
      (query) =>
        query
          .not("text", "is", null)
          .order("received_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
    ),
  ]);

  const existingByLineUser = new Map(
    existingLinks.map((link) => [link.line_user_id, link.student_number]),
  );
  const existingByStudent = new Map(
    existingLinks.map((link) => [link.student_number, link.line_user_id]),
  );
  const aliasByLineUser = new Map(
    aliases.map((alias) => [alias.line_user_id, alias.alias_name ?? ""]),
  );

  const messagesByUser = new Map();
  for (const message of messages) {
    if (!messagesByUser.has(message.line_user_id)) {
      messagesByUser.set(message.line_user_id, []);
    }
    messagesByUser.get(message.line_user_id).push(message);
  }

  let entries = [...messagesByUser.entries()];
  if (args.limitUsers) entries = entries.slice(0, args.limitUsers);

  const reportRows = [];
  const linksToApply = [];

  for (const [lineUserId, userMessages] of entries) {
    const firstMessages = userMessages.slice(0, args.firstMessages);
    const displayName =
      firstMessages.find((message) => message.display_name)?.display_name ??
      userMessages.find((message) => message.display_name)?.display_name ??
      "";
    const aliasName = aliasByLineUser.get(lineUserId) ?? "";
    const greetingNames = extractGreetingNames(firstMessages);
    const existingStudentNumber = existingByLineUser.get(lineUserId) ?? "";
    const result = chooseCandidate(
      students,
      firstMessages,
      displayName,
      aliasName,
      greetingNames,
      args.minScore,
      args.minDelta,
    );

    const top = result.top;
    let status = result.status;
    if (existingStudentNumber) status = "linked_already";
    if (
      top &&
      !existingStudentNumber &&
      existingByStudent.has(top.student.student_number) &&
      !args.overwrite
    ) {
      status = "review_student_already_linked";
    }

    const row = {
      status,
      line_user_id: lineUserId,
      line_display_name: displayName,
      school_alias_name: aliasName,
      score: top?.score ?? "",
      student_number: top?.student.student_number ?? "",
      student_name: top?.student.student_name ?? "",
      grade: top?.student.grade ?? "",
      homeroom_teacher: top?.student.homeroom_teacher ?? "",
      matched_by: top?.reasons.join("+") ?? "",
      auto_reply_names: greetingNames.join(" | "),
      matched_at: top?.matchedAt ?? "",
      matched_text: top?.matchedText ?? "",
      existing_student_number: existingStudentNumber,
      alternatives: result.alternatives
        .map(
          (candidate) =>
            `${candidate.student.student_number}:${candidate.student.student_name}:${candidate.score}`,
        )
        .join(" | "),
    };
    reportRows.push(row);

    if (status === "auto_candidate" && top) {
      linksToApply.push({
        student_number: top.student.student_number,
        line_user_id: lineUserId,
        updated_at: new Date().toISOString(),
      });
    }
  }

  writeCsv(args.output, reportRows);

  if (args.apply && linksToApply.length > 0) {
    const { error } = await supabase
      .from("student_line_links")
      .upsert(linksToApply, { onConflict: "student_number" });
    if (error) throw error;
  }

  const summary = reportRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    students: students.length,
    line_users_checked: entries.length,
    output: args.output,
    apply_candidates: linksToApply.length,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
