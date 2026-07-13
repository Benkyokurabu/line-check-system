import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";

const DEFAULT_REPORT = "line_history_import_report.csv";
const LINE_USERS_EXPORT = "line_users_export.csv";

const HEADER_ALIASES = {
  lineUserId: [
    "line_user_id",
    "user_id",
    "userid",
    "lineuserid",
    "line id",
    "lineid",
    "ユーザーid",
    "ユーザid",
    "lineユーザーid",
  ],
  displayName: [
    "display_name",
    "line_name",
    "name",
    "user_name",
    "username",
    "表示名",
    "ユーザー名",
    "名前",
    "アカウント名",
  ],
  text: [
    "text",
    "message",
    "body",
    "content",
    "本文",
    "メッセージ",
    "チャット内容",
    "内容",
  ],
  direction: [
    "direction",
    "type",
    "sender_type",
    "送受信",
    "種別",
    "方向",
  ],
  sentBy: [
    "sent_by",
    "sender",
    "from",
    "送信者",
    "担当者",
  ],
  timestamp: [
    "received_at",
    "created_at",
    "timestamp",
    "datetime",
    "date",
    "time",
    "日時",
    "日付",
    "送信日時",
    "受信日時",
  ],
};

function parseArgs(argv) {
  const args = {
    input: null,
    apply: false,
    report: DEFAULT_REPORT,
    defaultDirection: "inbound",
    sheet: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      args.input = next;
      i += 1;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--report" && next) {
      args.report = next;
      i += 1;
    } else if (arg === "--default-direction" && next) {
      args.defaultDirection = normalizeDirection(next) ?? "inbound";
      i += 1;
    } else if (arg === "--sheet" && next) {
      args.sheet = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) {
    throw new Error("Missing --input <csv-or-xlsx-path>.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run import:line-history -- --input <csv-or-xlsx-path> [options]

Options:
  --apply                         Insert/update rows in line_messages.
  --report <path>                 Import report CSV path. Default: ${DEFAULT_REPORT}
  --default-direction inbound     Direction when the file has no direction column. Default: inbound
  --default-direction outbound
  --sheet <name>                  XLSX sheet name. Default: first sheet

Default mode is dry-run: it writes only a report and does not update the database.

Required data per row:
  - message text
  - line_user_id, or a display/name column that can be resolved to one known LINE user`);
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

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_＿\-－:：]/g, "");
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pick(row, field) {
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key))) return value;
  }
  return undefined;
}

function normalizeDirection(value) {
  const text = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!text) return null;
  if (["inbound", "incoming", "receive", "received", "受信", "受信メッセージ", "ユーザー", "友だち"].includes(text)) {
    return "inbound";
  }
  if (["outbound", "outgoing", "send", "sent", "送信", "送信メッセージ", "bot", "公式", "学校", "塾"].includes(text)) {
    return "outbound";
  }
  if (text.includes("受信")) return "inbound";
  if (text.includes("送信")) return "outbound";
  return null;
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H,
        parsed.M,
        Math.floor(parsed.S),
      )).toISOString();
    }
  }

  const text = String(value).normalize("NFKC").trim();
  if (!text) return null;
  const normalized = text
    .replace(/[年/]/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\s+/g, " ");
  const date = new Date(normalized);
  if (Number.isFinite(date.getTime())) return date.toISOString();
  return null;
}

function messageIdFor(row) {
  const source = JSON.stringify([
    row.line_user_id,
    row.direction,
    row.received_at,
    row.text,
    row.sent_by,
  ]);
  return `import:${crypto.createHash("sha256").update(source).digest("hex").slice(0, 40)}`;
}

function readRows(inputPath, sheetName) {
  const workbook = xlsx.readFile(inputPath, { cellDates: true });
  const selectedSheet = sheetName ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) {
    throw new Error(`Sheet not found: ${selectedSheet}`);
  }
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
}

function readLocalLineUsersExport() {
  if (!fs.existsSync(LINE_USERS_EXPORT)) return [];
  const workbook = xlsx.readFile(LINE_USERS_EXPORT);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
}

async function buildNameResolver(supabase) {
  const nameToUserIds = new Map();

  function add(name, lineUserId) {
    const normalized = normalizeName(name);
    if (!normalized || !lineUserId) return;
    if (!nameToUserIds.has(normalized)) nameToUserIds.set(normalized, new Set());
    nameToUserIds.get(normalized).add(lineUserId);
  }

  const [{ data: aliases, error: aliasesError }, { data: messages, error: messagesError }] =
    await Promise.all([
      supabase.from("line_user_aliases").select("line_user_id,alias_name"),
      supabase
        .from("line_messages")
        .select("line_user_id,display_name")
        .not("display_name", "is", null),
    ]);

  if (aliasesError) throw aliasesError;
  if (messagesError) throw messagesError;

  for (const row of aliases ?? []) add(row.alias_name, row.line_user_id);
  for (const row of messages ?? []) add(row.display_name, row.line_user_id);
  for (const row of readLocalLineUsersExport()) {
    add(row.line_name, row.line_user_id);
    add(row.alias_name, row.line_user_id);
  }

  return (name) => {
    const ids = [...(nameToUserIds.get(normalizeName(name)) ?? [])];
    return {
      lineUserId: ids.length === 1 ? ids[0] : null,
      candidates: ids,
    };
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
    "display_name",
    "direction",
    "received_at",
    "text",
    "reason",
    "resolved_candidates",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const supabase = createSupabase();
  const resolveName = await buildNameResolver(supabase);
  const rawRows = readRows(inputPath, args.sheet);
  const reportRows = [];
  const insertRows = [];

  for (const rawRow of rawRows) {
    const text = String(pick(rawRow, "text") ?? "").trim();
    const displayName = String(pick(rawRow, "displayName") ?? "").trim();
    const explicitLineUserId = String(pick(rawRow, "lineUserId") ?? "").trim();
    const direction = normalizeDirection(pick(rawRow, "direction")) ?? args.defaultDirection;
    const sentBy = String(pick(rawRow, "sentBy") ?? "").trim() || null;
    const receivedAt = parseTimestamp(pick(rawRow, "timestamp"));

    let lineUserId = explicitLineUserId;
    let resolvedCandidates = [];
    if (!lineUserId && displayName) {
      const resolved = resolveName(displayName);
      lineUserId = resolved.lineUserId ?? "";
      resolvedCandidates = resolved.candidates;
    }

    let status = "ready";
    let reason = "";
    if (!text) {
      status = "skipped";
      reason = "missing text";
    } else if (!lineUserId) {
      status = "unresolved";
      reason = displayName ? "display name did not resolve to exactly one line_user_id" : "missing line_user_id and display name";
    } else if (!["inbound", "outbound"].includes(direction)) {
      status = "skipped";
      reason = "invalid direction";
    }

    const lineMessage = {
      line_message_id: "",
      line_user_id: lineUserId,
      display_name: displayName || null,
      message_type: "text",
      text,
      direction,
      received_at: receivedAt,
      raw_event: {
        imported_from: path.basename(inputPath),
        row: rawRow,
      },
      sent_by: direction === "outbound" ? sentBy : null,
    };
    lineMessage.line_message_id = messageIdFor(lineMessage);

    if (status === "ready") insertRows.push(lineMessage);

    reportRows.push({
      status,
      line_user_id: lineUserId,
      display_name: displayName,
      direction,
      received_at: receivedAt ?? "",
      text: text.slice(0, 200),
      reason,
      resolved_candidates: resolvedCandidates.join(" | "),
    });
  }

  writeCsv(args.report, reportRows);

  if (args.apply && insertRows.length > 0) {
    const { error } = await supabase.from("line_messages").upsert(insertRows, {
      onConflict: "line_message_id",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }

  const summary = reportRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    input: args.input,
    rows: rawRows.length,
    ready_to_import: insertRows.length,
    report: args.report,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
