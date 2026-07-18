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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readPasswordCandidates() {
  if (process.env.SUPABASE_DB_PASSWORD) return [process.env.SUPABASE_DB_PASSWORD];
  const passwordFile = path.resolve("supabase で設定したパスワード.txt");
  if (!fs.existsSync(passwordFile)) throw new Error("Supabase DB password is required");
  return fs.readFileSync(passwordFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && line.length <= 64 && !line.includes(":") && !line.includes(" "))
    .reverse();
}

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  const sql = fs.readFileSync(path.resolve("supabase/line_media_schema.sql"), "utf8");
  const passwords = readPasswordCandidates();
  const candidates = [
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
    ...[
      "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
      "us-east-1", "us-west-1", "eu-west-1", "eu-central-1",
    ].flatMap((region) => [0, 1].flatMap((poolerIndex) => [
      { host: `aws-${poolerIndex}-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
      { host: `aws-${poolerIndex}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
    ])),
  ];
  const errors = [];
  for (const candidate of candidates) {
    for (const password of passwords) {
      const client = new Client({ ...candidate, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
      try {
        await client.connect();
        await client.query(sql);
        await client.end();
        console.log(JSON.stringify({ ok: true, host: candidate.host, bucket: "line-message-media" }));
        return;
      } catch (error) {
        try { await client.end(); } catch {}
        errors.push(`${candidate.host}:${candidate.port}:${error instanceof Error ? error.message : error}`);
      }
    }
  }
  throw new Error(`Could not apply LINE media schema: ${errors.join(" | ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
