import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const allowedTables = new Set(["student_roster", "student_line_accounts", "student_line_links", "line_user_aliases"]);

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

async function main() {
  const tables = process.argv.slice(2);
  if (!tables.length || tables.some((table) => !allowedTables.has(table))) throw new Error("Specify one or more allowed table names.");
  loadEnv(path.resolve(".env.local"));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  for (const table of tables) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select("*").range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const output = `${table}.before_explicit_line_link_${stamp}.json`;
    fs.writeFileSync(output, JSON.stringify(rows, null, 2), "utf8");
    console.log(JSON.stringify({ table, rows: rows.length, output }));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
