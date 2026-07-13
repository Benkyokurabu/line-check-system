import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_CONTACTS = "line_manager_contacts.csv";
const DEFAULT_PROFILES = "line_profiles_export.csv";
const DEFAULT_OUTPUT = "line_manager_alias_import_report.csv";
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = {
    apply: false,
    overwrite: false,
    contacts: DEFAULT_CONTACTS,
    profiles: DEFAULT_PROFILES,
    output: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--overwrite") args.overwrite = true;
    else if (arg === "--contacts" && next) {
      args.contacts = next;
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
  npm run import:line-manager-aliases -- [options]

Options:
  --contacts <path>  CSV from export:line-manager-contacts. Default: ${DEFAULT_CONTACTS}
  --profiles <path>  CSV from export:line-profiles. Default: ${DEFAULT_PROFILES}
  --output <path>    Import report CSV path. Default: ${DEFAULT_OUTPUT}
  --apply            Write matched aliases to line_user_aliases.
  --overwrite        With --apply, replace an existing different alias.

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

function normalizePictureUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .replace(/[?#].*$/, "")
    .replace(/\/preview$/, "")
    .replace(/\/large$/, "")
    .replace(/\/small$/, "");
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
    "existing_alias_name",
    "profile_display_name",
    "stored_display_name",
    "match_method",
    "image_src",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function selectAllAliases(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("line_user_aliases")
      .select("line_user_id,alias_name,group_name")
      .range(from, to);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildProfileIndex(profileRows) {
  const byPicture = new Map();
  for (const profile of profileRows) {
    const key = normalizePictureUrl(profile.picture_url);
    if (!key || profile.profile_fetch_status !== "ok") continue;
    if (!byPicture.has(key)) byPicture.set(key, []);
    byPicture.get(key).push(profile);
  }
  return byPicture;
}

function uniqueAliasRows(contactRows) {
  const rowsByKey = new Map();
  for (const contact of contactRows) {
    if (!["contact", "chat"].includes(contact.source)) continue;
    const aliasName = String(contact.alias_name ?? "").trim();
    const imageSrc = String(contact.image_src ?? "").trim();
    if (!aliasName || !imageSrc) continue;
    const key = `${aliasName}|${normalizePictureUrl(imageSrc)}`;
    if (!rowsByKey.has(key)) rowsByKey.set(key, contact);
  }
  return [...rowsByKey.values()];
}

function uniqueDirectAliasRows(contactRows) {
  const rowsByLineUser = new Map();
  for (const contact of contactRows) {
    const lineUserId = String(contact.line_user_id ?? "").trim();
    const aliasName = String(contact.alias_name ?? "").trim();
    if (!lineUserId || !aliasName) continue;
    if (!rowsByLineUser.has(lineUserId)) rowsByLineUser.set(lineUserId, contact);
  }
  return [...rowsByLineUser.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createSupabase();

  const contactCsvRows = readCsv(args.contacts);
  const directContacts = uniqueDirectAliasRows(contactCsvRows);
  const contacts = directContacts.length > 0 ? directContacts : uniqueAliasRows(contactCsvRows);
  const profiles = readCsv(args.profiles);
  const existingAliases = await selectAllAliases(supabase);
  const existingByLineUser = new Map(
    existingAliases.map((row) => [row.line_user_id, row.alias_name ?? ""]),
  );
  const profileByPicture = buildProfileIndex(profiles);

  const reportRows = [];
  const upserts = [];

  for (const contact of contacts) {
    const directLineUserId = String(contact.line_user_id ?? "").trim();
    const directProfile =
      directLineUserId
        ? profiles.find((profile) => profile.line_user_id === directLineUserId) ?? {
            line_user_id: directLineUserId,
            profile_display_name: "",
            stored_display_name: "",
          }
        : null;
    const imageKey = normalizePictureUrl(contact.image_src);
    const matchedProfiles = directProfile ? [directProfile] : profileByPicture.get(imageKey) ?? [];
    if (matchedProfiles.length !== 1) {
      reportRows.push({
        status: matchedProfiles.length ? "ambiguous_picture" : "no_profile_picture_match",
        line_user_id: "",
        alias_name: contact.alias_name,
        existing_alias_name: "",
        profile_display_name: "",
        stored_display_name: "",
        match_method: directLineUserId ? "line_user_id" : "picture_url",
        image_src: contact.image_src,
      });
      continue;
    }

    const profile = matchedProfiles[0];
    const existingAlias = existingByLineUser.get(profile.line_user_id) ?? "";
    let status = "insert";
    if (existingAlias && existingAlias === contact.alias_name) {
      status = "same_existing";
    } else if (existingAlias && existingAlias !== contact.alias_name) {
      status = args.overwrite ? "overwrite" : "different_existing";
    }

    reportRows.push({
      status,
      line_user_id: profile.line_user_id,
      alias_name: contact.alias_name,
      existing_alias_name: existingAlias,
      profile_display_name: profile.profile_display_name,
      stored_display_name: profile.stored_display_name,
      match_method: directLineUserId ? "line_user_id" : "picture_url",
      image_src: contact.image_src,
    });

    if (status === "insert" || status === "overwrite") {
      upserts.push({
        line_user_id: profile.line_user_id,
        alias_name: contact.alias_name,
        updated_at: new Date().toISOString(),
      });
    }
  }

  writeCsv(args.output, reportRows);

  if (args.apply && upserts.length > 0) {
    const { error } = await supabase
      .from("line_user_aliases")
      .upsert(upserts, { onConflict: "line_user_id" });
    if (error) throw error;
  }

  const summary = reportRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    contacts: contacts.length,
    profiles: profiles.length,
    upsert_candidates: upserts.length,
    output: args.output,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
