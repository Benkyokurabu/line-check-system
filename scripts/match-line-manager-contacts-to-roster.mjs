import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import XLSX from "xlsx";

const DEFAULT_CONTACTS = "line_manager_contacts.csv";
const DEFAULT_OUTPUT = "line_manager_roster_match.csv";

function parseArgs(argv) {
  const args = {
    contacts: DEFAULT_CONTACTS,
    output: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--contacts" && next) {
      args.contacts = next;
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
  node scripts/match-line-manager-contacts-to-roster.mjs [options]

Options:
  --contacts <path>  CSV from export:line-manager-contacts. Default: ${DEFAULT_CONTACTS}
  --output <path>    Match report CSV. Default: ${DEFAULT_OUTPUT}`);
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
        source_file: file,
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

function stripContactWords(value) {
  return normalize(value)
    .replace(/(さん|様|くん|ちゃん)$/g, "")
    .replace(/(お母様|お母さん|母|父|保護者|ママ|パパ)$/g, "");
}

function scoreContact(contactAlias, studentName) {
  const alias = stripContactWords(contactAlias);
  const student = normalize(studentName);
  if (!alias || !student) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  if (alias === student) {
    score += 200;
    reasons.push("exact");
  }
  if (alias.includes(student)) {
    score += 150;
    reasons.push("alias_contains_student_name");
  }

  const nameParts = studentName
    .normalize("NFKC")
    .split(/[ \t\r\n\u3000]+/)
    .map((part) => normalize(part))
    .filter(Boolean);
  for (const part of nameParts) {
    if (part.length >= 2 && alias.includes(part)) {
      score += 40;
      reasons.push(`name_part:${part}`);
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

function chooseMatch(contact, roster) {
  const candidates = roster
    .map((student) => {
      const scored = scoreContact(contact.alias_name, student.student_name);
      return { student, ...scored };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  if (!top) return { status: "no_match", top: null, second: null, alternatives: [] };

  const delta = top.score - (second?.score ?? 0);
  const status = top.score >= 150 && delta >= 40 ? "auto_candidate" : "review";
  return { status, top, second, alternatives: candidates.slice(1, 4) };
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
    "alias_name",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const contacts = readCsv(args.contacts).filter((row) => row.line_user_id && row.alias_name);
  const roster = readRoster(rootDir);

  const reportRows = contacts.map((contact) => {
    const match = chooseMatch(contact, roster);
    const top = match.top;
    return {
      status: match.status,
      line_user_id: contact.line_user_id,
      alias_name: contact.alias_name,
      student_number: top?.student.student_number ?? "",
      student_name: top?.student.student_name ?? "",
      grade: top?.student.grade ?? "",
      homeroom_teacher: top?.student.homeroom_teacher ?? "",
      score: top?.score ?? "",
      matched_by: top?.reasons.join("+") ?? "",
      alternatives: match.alternatives
        .map((candidate) => `${candidate.student.student_number}:${candidate.student.student_name}:${candidate.score}`)
        .join(" | "),
    };
  });

  writeCsv(args.output, reportRows);

  const summary = reportRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    contacts: contacts.length,
    roster_students: roster.length,
    output: args.output,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
