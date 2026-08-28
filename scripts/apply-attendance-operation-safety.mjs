import fs from "node:fs";
import path from "node:path";
import pg from "pg";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const passwordFile = path.resolve("supabase で設定したパスワード.txt");
const password = process.env.SUPABASE_DB_PASSWORD || fs.readFileSync(passwordFile, "utf8").trim().split(/\r?\n/)[0].trim();
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const migrationPath = path.resolve("supabase", "attendance_operation_safety_20260828.sql");
const sql = fs.readFileSync(migrationPath, "utf8");
const verifyOnly = process.argv.includes("--verify-only");
const candidates = [
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
  ...["ap-northeast-1", "ap-northeast-2", "ap-southeast-1"].flatMap((region) => [0, 1].flatMap((n) => [
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    { host: `aws-${n}-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
  ])),
];

for (const connection of candidates) {
  const client = new pg.Client({ ...connection, database: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000 });
  try {
    await client.connect();
    if (verifyOnly) {
      await client.query("begin");
      await client.query(sql.replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, ""));
      await client.query("rollback");
    } else {
      await client.query(sql);
    }
    await client.end();
    console.log(JSON.stringify({ ok: true, mode: verifyOnly ? "verified_and_rolled_back" : "applied", host: connection.host, port: connection.port }, null, 2));
    process.exit(0);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
    if (process.env.DEBUG_ATTENDANCE_MIGRATION === "1") console.error(error instanceof Error ? error.message : String(error));
  }
}

throw new Error("Could not validate or apply the attendance operation safety migration");
