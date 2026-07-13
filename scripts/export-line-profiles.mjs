import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_OUTPUT = "line_profiles_export.csv";
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--limit" && next) {
      args.limit = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 1)) {
    args.limit = null;
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run export:line-profiles -- [options]

Options:
  --output <path>  CSV output path. Default: ${DEFAULT_OUTPUT}
  --limit <num>    Fetch only the first N users for verification.`);
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

async function selectAllLineUsers(supabase) {
  const users = new Map();
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("line_messages")
      .select("line_user_id,display_name")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) throw error;
    for (const row of data ?? []) {
      if (!users.has(row.line_user_id)) {
        users.set(row.line_user_id, row.display_name ?? "");
      } else if (!users.get(row.line_user_id) && row.display_name) {
        users.set(row.line_user_id, row.display_name);
      }
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return [...users.entries()].map(([lineUserId, storedDisplayName]) => ({
    lineUserId,
    storedDisplayName,
  }));
}

async function fetchProfile(lineUserId, accessToken) {
  const response = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      displayName: "",
      statusMessage: "",
      pictureUrl: "",
    };
  }

  const data = await response.json();
  return {
    ok: true,
    status: response.status,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    statusMessage: typeof data.statusMessage === "string" ? data.statusMessage : "",
    pictureUrl: typeof data.pictureUrl === "string" ? data.pictureUrl : "",
  };
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(outputPath, rows) {
  const headers = [
    "line_user_id",
    "stored_display_name",
    "profile_display_name",
    "status_message",
    "picture_url",
    "has_status_message",
    "profile_fetch_status",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.resolve(".env.local"));
  loadEnvFile(path.resolve(".env.vercel-import"));

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required.");
  }

  const supabase = createSupabase();
  let users = await selectAllLineUsers(supabase);
  if (args.limit) users = users.slice(0, args.limit);

  const rows = [];
  for (const user of users) {
    const profile = await fetchProfile(user.lineUserId, accessToken);
    rows.push({
      line_user_id: user.lineUserId,
      stored_display_name: user.storedDisplayName,
      profile_display_name: profile.displayName,
      status_message: profile.statusMessage,
      picture_url: profile.pictureUrl,
      has_status_message: profile.statusMessage ? "yes" : "no",
      profile_fetch_status: profile.ok ? "ok" : `failed:${profile.status}`,
    });
  }

  writeCsv(args.output, rows);

  const withStatusMessage = rows.filter((row) => row.has_status_message === "yes").length;
  const failed = rows.filter((row) => row.profile_fetch_status !== "ok").length;
  console.log(JSON.stringify({
    checked: rows.length,
    with_status_message: withStatusMessage,
    failed,
    output: args.output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
