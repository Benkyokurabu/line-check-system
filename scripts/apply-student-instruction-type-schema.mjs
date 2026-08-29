import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const { Client } = pg;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function passwordCandidates() {
  if (process.env.SUPABASE_DB_PASSWORD) return [process.env.SUPABASE_DB_PASSWORD];
  const file = path.resolve("supabase で設定したパスワード.txt");
  if (!fs.existsSync(file)) throw new Error("Supabase DB password is not available locally.");
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((value) => value.trim())
    .filter((value) => value.length >= 12 && value.length <= 64 && !value.includes(":"))
    .reverse();
}

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is required.");
  const projectRef = new URL(url).hostname.split(".")[0];
  const sql = fs.readFileSync(path.resolve("supabase", "student_instruction_type_20260829.sql"), "utf8");
  const targets = [
    { host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 6543, user: `postgres.${projectRef}` },
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  ];
  const errors = [];
  for (const target of targets) {
    for (const password of passwordCandidates()) {
      const client = new Client({ ...target, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
      try {
        await client.connect();
        await client.query(sql);
        const verification = await client.query(`
          select
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'student_roster' and column_name = 'instruction_type'
            ) as instruction_type_column,
            to_regprocedure('public.get_line_contact_admin_summaries()') is not null as summary_function
        `);
        if (!verification.rows[0]?.instruction_type_column || !verification.rows[0]?.summary_function) throw new Error("schema verification failed");
        await client.end();
        console.log(JSON.stringify({ ok: true, host: target.host, port: target.port, ...verification.rows[0] }, null, 2));
        return;
      } catch (error) {
        try { await client.end(); } catch {}
        errors.push(`${target.host}:${target.port}:${error instanceof Error ? error.message : error}`);
      }
    }
  }
  throw new Error(`Could not apply student instruction type schema. ${errors.slice(-4).join(" | ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
